// Combine independent rule updates without starting any request before its
// Cookie/Header rule has been committed by Chrome.
export class RuleBatcher {
  constructor(update){this.update=update;this.pending=[];this.running=false;this.timer=null;this.stats={calls:0,operations:0};}
  submit(change){
    return new Promise((resolve,reject)=>{this.pending.push({change,resolve,reject});this.schedule();});
  }
  schedule(){if(!this.running&&!this.timer&&this.pending.length)this.timer=setTimeout(()=>{this.timer=null;void this.flush();},2);}
  async flush(){
    if(this.running)return;
    this.running=true;const batch=this.pending.splice(0),remove=new Set(),add=new Map();
    for(const {change} of batch){
      for(const id of change.removeRuleIds||[]){remove.add(id);add.delete(id);}
      for(const rule of change.addRules||[]){remove.add(rule.id);add.set(rule.id,rule);}
    }
    this.stats.calls++;this.stats.operations+=batch.length;
    try{
      await this.update({removeRuleIds:[...remove],addRules:[...add.values()]});
      for(const item of batch)item.resolve();
    }catch(error){
      // One unsupported URL/rule must not fail unrelated resources in the same
      // batch. The failed aggregate update is atomic; retry each original op.
      if(batch.length===1)batch[0].reject(error);
      else for(const item of batch){try{this.stats.calls++;await this.update(item.change);item.resolve();}catch(e){item.reject(e);}}
    }finally{this.running=false;this.schedule();}
  }
}
