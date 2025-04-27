// src/examples/dbHooks/mongodb.ts
import { DbCancellationHook } from '../../types';
import type { MongoClient, Db } from 'mongodb';

/**
 * Creates a cancellation hook for MongoDB
 * @param db MongoDB database instance
 * @returns DbCancellationHook function
 */
export function createMongoDbCancellationHook(db: Db): DbCancellationHook {
  return async (requestId: string, dbIdentifier: { operationId: number }): Promise<boolean> => {
    try {
      if (!dbIdentifier || typeof dbIdentifier.operationId !== 'number') {
        console.error(`Invalid dbIdentifier for MongoDB cancellation, requestId: ${requestId}`);
        return false;
      }

      // Execute db.killOp() to cancel the specific operation
      const result = await db.command({ killOp: 1, op: dbIdentifier.operationId });
      const success = result?.ok === 1;

      if (success) {
        console.log(`Successfully cancelled MongoDB operation with ID ${dbIdentifier.operationId} for request ${requestId}`);
      } else {
        console.warn(`Failed to cancel MongoDB operation with ID ${dbIdentifier.operationId} for request ${requestId}`);
      }

      return success;
    } catch (error) {
      console.error(`Error cancelling MongoDB operation for request ${requestId}:`, error);
      return false;
    }
  };
}

/**
 * Helper function to get MongoDB operation ID from the currentOp command
 * This is useful for tracking long-running operations that might need to be cancelled
 * @param db MongoDB database instance
 * @param filter Filter to match operations (e.g., { ns: 'mydb.mycollection' })
 * @returns Promise resolving to the operation ID if found
 */
export async function getMongoDbOperationId(db: Db, filter: object = {}): Promise<number | null> {
  try {
    const currentOp = await db.command({ currentOp: 1, ...filter });
    
    if (currentOp?.inprog && currentOp.inprog.length > 0) {
      // Return the most recent operation's ID
      return currentOp.inprog[0].opid;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting MongoDB operation ID:', error);
    return null;
  }
}
