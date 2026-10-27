/* Document-level history stays independent of Vditor's rendering mode. */
(function(root){
  class DocumentHistory {
    constructor(value=''){this.reset(value);}
    reset(value){this.values=[value];this.index=0;this.lastEdit=0;this.grouping=false;}
    boundary(){this.grouping=false;}
    record(value,now=Date.now()){
      if(value===this.values[this.index])return;
      this.values.length=this.index+1;
      if(this.grouping && now-this.lastEdit<750)this.values[this.index]=value;
      else {this.values.push(value);this.index++;}
      while(this.values.length>50 || (this.values.length>2 && this.values.reduce((sum,x)=>sum+x.length,0)>16000000)){this.values.shift();this.index--;}
      this.lastEdit=now;this.grouping=true;
    }
    move(delta){this.boundary();const next=this.index+delta;if(next<0 || next>=this.values.length)return null;this.index=next;return this.values[next];}
  }
  if(typeof module==='object')module.exports=DocumentHistory;else root.DocumentHistory=DocumentHistory;
})(globalThis);
