import dagre from 'dagre';
import { Node, Edge } from '@xyflow/react';

interface LayoutOptions {
  rankdir?: 'TB' | 'BT' | 'LR' | 'RL';
  nodeWidth?: number;
  nodeHeight?: number;
  ranksep?: number;
  nodesep?: number;
}

/**
 * Apply dagre layout to nodes based on their connections
 * Returns new nodes array with calculated positions
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): Node[] {
  const {
    rankdir = 'TB',
    nodeWidth = 280,
    nodeHeight = 120,
    ranksep = 150,
    nodesep = 100,
  } = options;

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir, ranksep, nodesep });

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  // Add edges to dagre graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Calculate layout
  dagre.layout(dagreGraph);

  // Apply calculated positions to nodes
  return nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });
}

/**
 * Check if nodes already have valid positions
 */
export function nodesHavePositions(nodes: Node[]): boolean {
  return nodes.every(
    (node) =>
      node.position &&
      typeof node.position.x === 'number' &&
      typeof node.position.y === 'number' &&
      (node.position.x !== 0 || node.position.y !== 0)
  );
}

