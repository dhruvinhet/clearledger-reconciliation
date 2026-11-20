import platformText from './platform_transactions.csv?raw';
import bankText from './bank_settlements.csv?raw';
import { parseCsv } from '../engine/csv';
export { platformText, bankText };
export const samplePlatform = parseCsv(platformText, 'platform');
export const sampleBank = parseCsv(bankText, 'bank');
