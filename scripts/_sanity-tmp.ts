import { MainnetConfig } from '../src/config.js';
import { waitForSync } from '../src/api.js';
console.log('imports ok');
console.log('cfg.indexer:', new MainnetConfig().indexer);
console.log('waitForSync type:', typeof waitForSync);
