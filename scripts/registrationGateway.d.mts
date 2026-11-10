import type { IncomingMessage, ServerResponse } from 'node:http';
export function handleRegistration(request: IncomingMessage, response: ServerResponse): Promise<void>;
export function registrationStatus(): Promise<{configured:boolean;weightsRequired:boolean;mode?:string;label?:string;reason?:string;algorithmVersion?:string}>;
