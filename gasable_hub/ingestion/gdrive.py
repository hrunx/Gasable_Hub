from __future__ import annotations

import io
import os
import pickle
from typing import Iterable
import json

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from pypdf import PdfReader

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
CREDS_FILE = os.getenv("GDRIVE_CREDS_FILE", "credentials.json")
TOKEN_FILE = os.getenv("GDRIVE_TOKEN_FILE", "token.pickle")
EXCLUDE_MIME_TYPES = {
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.google-apps.spreadsheet",
}


def _ensure_credentials_file_from_env() -> None:
	if os.path.exists(CREDS_FILE):
		return
	client_id = os.getenv("GDRIVE_CLIENT_ID") or os.getenv("Client_ID")
	client_secret = os.getenv("GDRIVE_CLIENT_SECRET") or os.getenv("Client_secret")
	if not client_id or not client_secret:
		return
	data = {
		"installed": {
			"client_id": client_id,
			"project_id": os.getenv("GDRIVE_PROJECT_ID", "gasable"),
			"auth_uri": "https://accounts.google.com/o/oauth2/auth",
			"token_uri": "https://oauth2.googleapis.com/token",
			"auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
			"client_secret": client_secret,
			"redirect_uris": ["http://localhost"],
		},
	}
	with open(CREDS_FILE, "w", encoding="utf-8") as f:
		json.dump(data, f)


def authenticate_google_drive():
	_ensure_credentials_file_from_env()
	creds = None
	# Robust token loading: ignore non-pickle files (e.g. JSON)
	if os.path.exists(TOKEN_FILE):
		try:
			with open(TOKEN_FILE, "rb") as token:
				creds = pickle.load(token)
		except Exception:
			creds = None
	if not creds or not creds.valid:
		if creds and creds.expired and creds.refresh_token:
			creds.refresh(Request())
		else:
			flow = InstalledAppFlow.from_client_secrets_file(CREDS_FILE, SCOPES)
			creds = flow.run_local_server(port=int(os.getenv("GDRIVE_OAUTH_PORT", "8080")))
		token_out = TOKEN_FILE if TOKEN_FILE.endswith(".pickle") else "token.pickle"
		with open(token_out, "wb") as token:
			pickle.dump(creds, token)
	service = build("drive", "v3", credentials=creds)
	return service


def fetch_files_from_drive(service, folder_id: str) -> list[dict]:
	results = (
		service.files()
		.list(
			q=f"'{folder_id}' in parents and trashed=false",
			spaces="drive",
			fields="files(id,name,mimeType)",
		)
		.execute()
	)
	return results.get("files", [])


def download_file_text(service, file_id: str) -> str:
	buf = io.BytesIO()
	request = service.files().get_media(fileId=file_id)
	downloader = MediaIoBaseDownload(buf, request)
	done = False
	while not done:
		status, done = downloader.next_chunk()
	buf.seek(0)
	return buf.read().decode("utf-8", errors="ignore")


def download_file_bytes(service, file_id: str) -> bytes:
	buf = io.BytesIO()
	request = service.files().get_media(fileId=file_id)
	downloader = MediaIoBaseDownload(buf, request)
	done = False
	while not done:
		status, done = downloader.next_chunk()
	return buf.getvalue()


def fetch_text_documents(service, folder_id: str) -> list[dict]:
	items = fetch_files_from_drive(service, folder_id)
	docs: list[dict] = []
	for it in items:
		mt = it.get("mimeType", "")
		if mt == "text/plain":
			try:
				text = download_file_text(service, it["id"])
				docs.append({"id": it["id"], "text": text})
			except Exception:
				continue
	return docs


def _list_recursive(service, folder_id: str) -> list[dict]:
	acc: list[dict] = []
	page_token = None
	while True:
		resp = (
			service.files()
			.list(
				q=f"'{folder_id}' in parents and trashed=false",
				spaces="drive",
				fields="nextPageToken, files(id,name,mimeType)",
				pageToken=page_token,
			)
			.execute()
		)
		items = resp.get("files", [])
		for it in items:
			acc.append(it)
			if it.get("mimeType") == "application/vnd.google-apps.folder":
				acc.extend(_list_recursive(service, it["id"]))
		page_token = resp.get("nextPageToken")
		if not page_token:
			break
	return acc


def _export_google_doc_text(service, file_id: str) -> str:
	buf = io.BytesIO()
	request = service.files().export_media(fileId=file_id, mimeType="text/plain")
	downloader = MediaIoBaseDownload(buf, request)
	done = False
	while not done:
		status, done = downloader.next_chunk()
	buf.seek(0)
	return buf.read().decode("utf-8", errors="ignore")


def fetch_text_documents_recursive(service, root_folder_id: str) -> list[dict]:
	items = _list_recursive(service, root_folder_id)
	docs: list[dict] = []
	for it in items:
		mt = it.get("mimeType", "")
		if mt == "application/vnd.google-apps.folder":
			continue
		if mt in EXCLUDE_MIME_TYPES:
			continue
		try:
			if mt == "application/vnd.google-apps.document":
				text = _export_google_doc_text(service, it["id"])
			elif mt in ("text/plain", "text/markdown"):
				text = download_file_text(service, it["id"])
			elif mt == "application/pdf":
				data = download_file_bytes(service, it["id"])
				pdf = PdfReader(io.BytesIO(data))
				pages = []
				for p in pdf.pages:
					try:
						pages.append(p.extract_text() or "")
					except Exception:
						continue
				text = "\n".join(pages)
			else:
				continue
			text = (text or "").strip()
			if text:
				docs.append({"id": it["id"], "text": text})
		except Exception:
			continue
	return docs


