export const config = {
  get dataDir(): string {
    return process.env.CA_DATA_DIR ?? '/etc/pwm-ca';
  },
  port: Number(process.env.PORT ?? 4433),
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
