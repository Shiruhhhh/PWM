function intFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`invalid integer env value: "${value}"`);
  }
  return parsed;
}

export const config = {
  get dataDir(): string {
    return process.env.CA_DATA_DIR ?? '/etc/pwm-ca';
  },
  get port(): number {
    return intFromEnv(process.env.PORT, 4433);
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
