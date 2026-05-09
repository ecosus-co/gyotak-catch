# gyotak-catch

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Midnight](https://img.shields.io/badge/Midnight-Preprod-purple)](https://midnight.network)

A Midnight Compact contract for sashimi-grade fish catch traceability,
operated by ECOSUS CO., LTD. (Pranburi, Thailand).

## Overview

ECOSUS operates **GYOTAK**, a sashimi-grade flash-frozen fish brand serving
B2B and B2C channels across Thailand. Every batch is published with provable
origin metadata so customers and auditors can independently verify a shipment.

The `gyotak-catch` contract publishes catch records — region, date, species,
photo hash, GPS hash — onto Midnight as cryptographic commitments. Sensitive
witness data (raw GPS coordinates, photo bytes) never leaves the operator's
device; only their hashes reach the chain.

## Mainnet deployment authorization application

This repository accompanies a Mainnet deployment authorization application
submitted to the Midnight Foundation:

- **Application document**: [`deployments/gyotak-catch.md`](deployments/gyotak-catch.md)
- **Empirical evidence**: [`preprod-evidence-2026-05-08/`](preprod-evidence-2026-05-08/) (Phase 2b rehearsal logs)

### Contract addresses

- **Score-1 (current)**, on Preprod:
  `53b8303fc72a83abd3d26e5372102a58cc9be55c42e383695b46a0f2d33e285f`
- **Score-3 (predecessor, archived)**, on Preprod:
  `a3f3a04476914b86eb914a4e3626519b1538395901fd376442a1fa8afffe836f`

## Repository structure

```
contracts/                    Compact source (gyotak-catch.compact)
src/                          TypeScript implementation (witness, API, CLI)
scripts/                      Operational tooling (verify-owner, etc.)
deployments/gyotak-catch.md   Mainnet authorization application
docs/                         Operational checklists and migration records
preprod-evidence-2026-05-08/  Raw log archive from Phase 2b rehearsal
patches/                      npm postinstall patches for SDK packages
```

## Build

```bash
npm install
npm run build:contract  # compile contracts/gyotak-catch.compact
```

The compiled artefacts live in `contracts/managed/`. SHA-256 fingerprints
are listed in `deployments/gyotak-catch.md` § 7.

## License

Apache License 2.0. See [LICENSE](LICENSE) for the full text.

## Contact

Takuya Ogura, Chairman
ECOSUS CO., LTD.
138/30 Moo 5, Pak Nam Pran Subdistrict, Pranburi, Prachuap Khiri Khan, Thailand
Email: ecosus2023@gmail.com
