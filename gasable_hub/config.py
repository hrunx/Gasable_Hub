import os
from dataclasses import dataclass
from dotenv import load_dotenv


@dataclass
class Settings:
	pg_host: str
	pg_port: int
	pg_user: str
	pg_password: str
	pg_dbname: str
	openai_api_key: str | None = None
	gdrive_folder_id: str | None = None
	embedding_dim: int = 1536
	migrations_dir: str = "migrations"
	db_auto_migrate: bool = False


def get_settings() -> Settings:
	# Load .env if present
	load_dotenv(override=False)
	return Settings(
		pg_host=os.getenv("PG_HOST", "localhost"),
		pg_port=int(os.getenv("PG_PORT", "5432")),
		pg_user=os.getenv("PG_USER", "postgres"),
		pg_password=os.getenv("PG_PASSWORD", ""),
		pg_dbname=os.getenv("PG_DBNAME", "gasable_db"),
		openai_api_key=os.getenv("OPENAI_API_KEY"),
		gdrive_folder_id=os.getenv("GDRIVE_FOLDER_ID"),
		embedding_dim=int(os.getenv("EMBEDDING_DIM", "1536")),
		migrations_dir=os.getenv("MIGRATIONS_DIR", "migrations"),
		db_auto_migrate=os.getenv("DB_AUTO_MIGRATE", "0") in ("1", "true", "True"),
	)


