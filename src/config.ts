import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

export const contractConfig = {
  privateStateStoreName: 'gyotak-catch-private-state',
  zkConfigPath: path.resolve(currentDir, '..', 'contracts', 'managed'),
};

export interface Config {
  readonly logDir: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
  // Optional: directory for persisting wallet sync state (shielded/unshielded/dust
  // serialized JSON). Set on networks where full sync is prohibitively slow
  // (Preprod ~170 min). Leave undefined to keep historical fresh-start behavior.
  readonly walletStateDir?: string;
}

export class StandaloneConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'standalone', `${new Date().toISOString()}.log`);
  indexer = 'http://127.0.0.1:8088/api/v4/graphql';
  indexerWS = 'ws://127.0.0.1:8088/api/v4/graphql';
  node = 'http://127.0.0.1:9944';
  proofServer = 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('undeployed');
  }
}

export class PreviewConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'preview', `${new Date().toISOString()}.log`);
  indexer = process.env.INDEXER_URI ?? 'https://indexer.preview.midnight.network/api/v4/graphql';
  indexerWS = process.env.INDEXER_WS_URI ?? 'wss://indexer.preview.midnight.network/api/v4/graphql/ws';
  node = process.env.NODE_URI ?? 'https://rpc.preview.midnight.network';
  proofServer = process.env.PROOF_SERVER_URI ?? 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('preview');
  }
}

export class MainnetConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'mainnet', `${new Date().toISOString()}.log`);
  indexer = process.env.INDEXER_URI ?? 'https://indexer.mainnet.midnight.network/api/v4/graphql';
  indexerWS = process.env.INDEXER_WS_URI ?? 'wss://indexer.mainnet.midnight.network/api/v4/graphql/ws';
  node = process.env.NODE_URI ?? 'https://rpc.mainnet.midnight.network';
  proofServer = process.env.PROOF_SERVER_URI ?? 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('mainnet');
  }
}

export class PreprodConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'preprod', `${new Date().toISOString()}.log`);
  walletStateDir = path.resolve(currentDir, '..', 'midnight-level-db', 'preprod');
  indexer = process.env.INDEXER_URI ?? 'https://indexer.preprod.midnight.network/api/v4/graphql';
  indexerWS = process.env.INDEXER_WS_URI ?? 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
  node = process.env.NODE_URI ?? 'https://rpc.preprod.midnight.network';
  proofServer = process.env.PROOF_SERVER_URI ?? 'https://proof-server.preprod.midnight.network';
  constructor() {
    setNetworkId('preprod');
  }
}
