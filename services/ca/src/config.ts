// Strict plain-decimal-integer check. Number()/Number.isInteger() alone
// accept hex ("0x10"), exponential ("1e2"), and negative ("-1") strings
// as "valid integers" -- all wrong for a port number, and PORT="0x10"
// would silently bind port 16 with no warning.
const PLAIN_DECIMAL_INTEGER = /^\d+$/;

function intFromEnv(
  value: string | undefined,
  fallback: number,
  options: { min: number; max: number },
): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (!PLAIN_DECIMAL_INTEGER.test(value)) {
    throw new Error(`invalid integer env value: "${value}"`);
  }
  const parsed = Number(value);
  if (parsed < options.min || parsed > options.max) {
    throw new Error(`env value "${value}" out of range (${options.min}-${options.max})`);
  }
  return parsed;
}

export const config = {
  get dataDir(): string {
    return process.env.CA_DATA_DIR ?? '/etc/pwm-ca';
  },
  get port(): number {
    return intFromEnv(process.env.PORT, 4433, { min: 1, max: 65535 });
  },
  host: process.env.HOST ?? '127.0.0.1',
  certExpiryDays: 90,
};

export function caKeyPath(): string {
  return `${config.dataDir}/ca.key`;
}

export function caCertPath(): string {
  return `${config.dataDir}/ca.crt`;
}

export function crlPath(): string {
  return `${config.dataDir}/crl.json`;
}

export function issuanceLogPath(): string {
  return `${config.dataDir}/issuance.log`;
}
