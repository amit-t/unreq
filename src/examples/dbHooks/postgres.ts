// src/examples/dbHooks/postgres.ts
import { DbCancellationHook } from '../../types';
import { Pool } from 'pg';

/**
 * Creates a cancellation hook for PostgreSQL
 * @param pool PostgreSQL connection pool
 * @returns DbCancellationHook function
 */
export function createPostgresCancellationHook(pool: Pool): DbCancellationHook {
  return async (requestId: string, dbIdentifier: { pid: number }): Promise<boolean> => {
    try {
      if (!dbIdentifier || typeof dbIdentifier.pid !== 'number') {
        console.error(`Invalid dbIdentifier for PostgreSQL cancellation, requestId: ${requestId}`);
        return false;
      }

      // Execute pg_cancel_backend to cancel the specific backend process
      const result = await pool.query('SELECT pg_cancel_backend($1)', [dbIdentifier.pid]);
      const success = result.rows?.[0]?.pg_cancel_backend === true;

      if (success) {
        console.log(`Successfully cancelled PostgreSQL query with PID ${dbIdentifier.pid} for request ${requestId}`);
      } else {
        console.warn(`Failed to cancel PostgreSQL query with PID ${dbIdentifier.pid} for request ${requestId}`);
      }

      return success;
    } catch (error) {
      console.error(`Error cancelling PostgreSQL query for request ${requestId}:`, error);
      return false;
    }
  };
}

/**
 * Helper function to get the PostgreSQL backend PID for the current connection
 * @param client PostgreSQL client
 * @returns Promise resolving to the backend PID
 */
export async function getPostgresBackendPid(client: any): Promise<number> {
  try {
    const result = await client.query('SELECT pg_backend_pid()');
    return result.rows[0].pg_backend_pid;
  } catch (error) {
    console.error('Error getting PostgreSQL backend PID:', error);
    throw error;
  }
}
