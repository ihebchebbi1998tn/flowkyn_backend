/**
 * Mock for src/config/database.ts
 * All DB functions return empty/null by default — override per test with mockImplementation.
 */

export const query = jest.fn().mockResolvedValue([]);
export const queryOne = jest.fn().mockResolvedValue(null);
export const transaction = jest.fn().mockImplementation(async (fn: Function) => {
  // Provide a mock client that mimics PoolClient
  const mockClient = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
  return fn(mockClient);
});
export const pool = {
  query: jest.fn(),
  connect: jest.fn(),
  on: jest.fn(),
};
export const checkConnection = jest.fn().mockResolvedValue(true);
