'use strict';

async function flushPendingArchives(db, liveId, pending){
  if(!/^checkin_D[A-Z2-9]{7}$/.test(liveId))return;
  const updates = {};
  for(const [operationId, entry] of Object.entries(pending || {})){
    if(!/^[a-zA-Z0-9_-]+$/.test(operationId) || !Number.isSafeInteger(entry?.at) || entry.at <= 0){
      throw new Error('Invalid pending archive');
    }
    updates[`liveArchive/${liveId}/${entry.at}`] = entry;
    updates[`live/${liveId}/pendingArchives/${operationId}`] = null;
  }
  if(!Object.keys(updates).length)return;
  // Saving the archive and acknowledging its outbox entry must succeed together.
  for(let attempt = 0; ; attempt++){
    try{ await db.ref().update(updates); return; }
    catch(error){ if(attempt >= 1)throw error; }
  }
}

module.exports = {flushPendingArchives};
