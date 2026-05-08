import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js/contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js/types';

import { Contract } from '../contracts/managed/contract/index.js';
import type { GyotakCatchPrivateState, witnesses } from './witnesses.js';

export const GyotakCatchPrivateStateId = 'gyotakCatchPrivateState' as const;
export type GyotakCatchPrivateStateIdT = typeof GyotakCatchPrivateStateId;

export type GyotakCatchContract = InstanceType<
  typeof Contract<GyotakCatchPrivateState, typeof witnesses>
>;

export type GyotakCatchCircuits = ProvableCircuitId<GyotakCatchContract>;

export type GyotakCatchProviders = MidnightProviders<
  GyotakCatchCircuits,
  GyotakCatchPrivateStateIdT,
  GyotakCatchPrivateState
>;

export type DeployedGyotakCatchContract =
  | DeployedContract<GyotakCatchContract>
  | FoundContract<GyotakCatchContract>;
