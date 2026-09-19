/** Preserve scoped-chat note observations when adopting the shared domain
 * ledger. Copy receipts verbatim; never infer past witnesses from current rooms.
 * The old rows are retained for recovery and historical snapshots.
 */
export function migrateScopedNoteLedger(db,campaignId) {
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='spatial_object_scopes'").get())return 0;
  return db.transaction(()=>{
    const ids=db.prepare("SELECT DISTINCT object_id FROM spatial_object_versions WHERE campaign_id=? AND object_type='note'").all(campaignId);
    let migrated=0;
    for(const {object_id:id} of ids) {
      if(db.prepare("SELECT 1 FROM spatial_object_versions WHERE campaign_id=? AND object_type='domain:note' AND object_id=?").get(campaignId,id))continue;
      const source=db.prepare("SELECT * FROM spatial_object_versions WHERE campaign_id=? AND object_type='note' AND object_id=? ORDER BY version").all(campaignId,id);
      const scopeRow=db.prepare("SELECT scope_json FROM spatial_object_scopes WHERE campaign_id=? AND object_type='note' AND object_id=?").get(campaignId,id);
      const scope=scopeRow?JSON.parse(scopeRow.scope_json):null;
      if(!scope||!['room','global','users'].includes(scope.kind))throw new Error('Legacy note scope cannot be migrated safely.');
      for(const row of source) {
        const data=JSON.parse(row.payload_json);
        const personal=data.visibility==='private'||data.status==='pending'&&data.authorKind!=='dm';
        const author=personal&&db.prepare('SELECT 1 FROM users WHERE id=?').get(data.authorUserId)?data.authorUserId:null;
        const current=row.version===source.at(-1).version;
        const binding=!current||data.visibility==='private'?{kind:'dm'}:scope.kind==='room'?{kind:'room',roomId:scope.roomId}
          :scope.kind==='global'?{kind:'global'}:{kind:'users',userIds:scope.userIds??[]};
        const envelope={format:'odm.domain.v1',scope:binding,ownerUserId:author,
          allowedUserIds:data.visibility==='private'||data.status==='pending'?[]:null,
          dmVisible:data.visibility!=='private'&&scope.dmCanRead!==false,deleted:data.__spatialDeleted===true,data};
        db.prepare('INSERT INTO spatial_object_versions(campaign_id,object_type,object_id,version,room_id,payload_json,seq) VALUES(?,?,?,?,?,?,?)')
          .run(campaignId,'domain:note',id,row.version,row.room_id,JSON.stringify(envelope),row.seq);
      }
      const receipts=db.prepare("SELECT * FROM spatial_object_receipts WHERE campaign_id=? AND object_type='note' AND object_id=?").all(campaignId,id);
      for(const receipt of receipts)db.prepare('INSERT INTO spatial_object_receipts(campaign_id,user_id,object_type,object_id,version,observed_seq) VALUES(?,?,?,?,?,?)')
        .run(campaignId,receipt.user_id,'domain:note',id,receipt.version,receipt.observed_seq);
      migrated++;
    }
    return migrated;
  })();
}
