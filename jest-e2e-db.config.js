/**
 * Config de jest para el e2e con DB real (test/app-db.e2e-spec.ts).
 *
 * Arranca AppModule completo, que importa @nestjs/schedule@12 (ESM puro). El
 * runtime de jest no soporta require(ESM), así que transformamos ese paquete
 * (y cron) a CommonJS con ts-jest. Correr con:
 *   E2E_DB=1 npx jest --config jest-e2e-db.config.js
 *
 * @type {import('jest').Config}
 */
// Habilita el gate del spec cuando se corre con esta config (con --runInBand
// los tests corren en el proceso principal, así que este env aplica).
process.env.E2E_DB = process.env.E2E_DB ?? '1';

module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['<rootDir>/test/app-db.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  maxWorkers: 1,
  transform: {
    '^.+\\.(ts|js)$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          allowJs: true,
          module: 'commonjs',
          target: 'es2021',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@nestjs/schedule|cron)/)'],
};
