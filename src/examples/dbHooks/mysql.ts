// src/examples/dbHooks/mysql.ts
import { DbCancellationHook } from '../../types';
import type { Connection, Pool } from 'mysql2/promise';

/**
 * Creates a cancellation hook for MySQL
 * @param pool MySQL connection pool
 * @returns DbCancellationHook function
 */
export function createMySqlCancellationHook(pool: Pool): DbCancellationHook {
  return async (requestId: string, dbIdentifier: { threadId: number }): Promise<boolean> => {
    try {
      if (!dbIdentifier || typeof dbIdentifier.threadId !== 'number') {
        console.error(`Invalid dbIdentifier for MySQL cancellation, requestId: ${requestId}`);
        return false;
      }

      // Execute KILL QUERY to cancel the specific query
      const [result] = await pool.execute('KILL QUERY ?', [dbIdentifier.threadId]);
      const success = !!result;

      if (success) {
        console.log(`Successfully cancelled MySQL query with thread ID ${dbIdentifier.threadId} for request ${requestId}`);
      } else {
        console.warn(`Failed to cancel MySQL query with thread ID ${dbIdentifier.threadId} for request ${requestId}`);
      }

      return success;
    } catch (error) {
      console.error(`Error cancelling MySQL query for request ${requestId}:`, error);
      return false;
    }
  };
}

/**
 * Helper function to get the MySQL thread ID for the current connection
 * @param connection MySQL connection
 * @returns The thread ID
 */
export function getMySqlThreadId(connection: Connection): number {
  return (connection as any).connection.threadId;
}
