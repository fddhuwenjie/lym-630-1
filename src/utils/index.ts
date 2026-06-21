import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function now(): string {
  return new Date().toISOString();
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export class BusinessError extends Error {
  public code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
  }
}

export function validateRequiredFields(data: Record<string, unknown>, requiredFields: string[]): void {
  const missing = requiredFields.filter(field => data[field] === undefined || data[field] === null || data[field] === '');
  if (missing.length > 0) {
    throw new BusinessError('MISSING_FIELDS', `缺少必填字段: ${missing.join(', ')}`);
  }
}
