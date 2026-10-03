import { CHECKPOINT_PLAYER_NOTICE, CheckpointRejectionError } from "@digital-evolution/contracts";
import type { PersistenceFailure } from "./persistence";
import { PersistenceFailure as PersistenceFailureClass } from "./persistence";
import { RuntimeCommandRejection } from "@digital-evolution/sim-runtime";

/**
 * F3a — player-facing wording for save and load failures.
 *
 * Every function here takes a TYPED failure and returns a sentence. None of them
 * parse a message, and none of them can return raw storage or developer text as
 * the primary explanation: the low-level detail is deliberately left to the log.
 *
 * The four outcomes a player must be able to tell apart (handoff §7):
 *   - no save exists;
 *   - save storage or read failed;
 *   - save was read but this build cannot restore it;
 *   - save write failed.
 */

const isPersistenceFailure=(error:unknown):error is PersistenceFailure=>error instanceof PersistenceFailureClass;

/** A storage-layer failure (read or write). */
export function storageFailureMessage(error:unknown):string{
  if(isPersistenceFailure(error)){
    switch(error.kind){
      case "no-save":return error.playerMessage;
      case "storage-read-failed":return `Could not read your saved universe. ${error.playerMessage}`;
      case "storage-write-failed":return `Could not save. ${error.playerMessage}`;
    }
  }
  // Anything unclassified still must not reach the player as raw storage text.
  return "Something went wrong reaching your saved universe. Your current world is unchanged.";
}

/**
 * A runtime rejection: the record was readable, but this build will not restore
 * it. The distinction from a storage failure is the whole point — one means the
 * bytes are gone, the other means the bytes are fine and the build disagrees.
 */
export function restoreFailureMessage(error:unknown):string{
  if(error instanceof CheckpointRejectionError){
    return `Restore failed: ${error.playerMessage} ${CHECKPOINT_PLAYER_NOTICE}`;
  }
  if(error instanceof RuntimeCommandRejection){
    return `Restore failed: ${error.playerMessage} Your current world is unchanged.`;
  }
  // An untyped failure is a defect in the classification path, not something to
  // show verbatim. Say what is true and keep the detail for the log.
  return "Restore failed: this saved universe could not be restored. Your current world is unchanged.";
}