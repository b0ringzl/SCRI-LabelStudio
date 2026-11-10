import type { IncomingMessage, ServerResponse } from 'node:http';
export function handleDepth(request: IncomingMessage, response: ServerResponse): Promise<void>;
export function depthStatus(): Promise<{configured:boolean;weightsRequired:boolean;device?:string;label?:string;reason?:string;algorithmVersion?:string}>;
