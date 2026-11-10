import type { Annotation, ToolMode, UV } from './types';
export interface EditSnapshot { annotations:Annotation[];draft:UV[];frameIndex:number;selectedId:string|null;vertex:number|null;tool:ToolMode;rectangle:boolean;extent:'surface'|'object' }
export class AnnotationHistory {
  undoStack:EditSnapshot[]=[];redoStack:EditSnapshot[]=[];
  record(snapshot:EditSnapshot){this.undoStack.push(snapshot);if(this.undoStack.length>60)this.undoStack.shift();this.redoStack=[];}
  undo(current:EditSnapshot){const previous=this.undoStack.pop();if(previous)this.redoStack.push(current);return previous;}
  redo(current:EditSnapshot){const next=this.redoStack.pop();if(next)this.undoStack.push(current);return next;}
  clear(){this.undoStack=[];this.redoStack=[];}
}
