import { createServerFn } from '@tanstack/react-start';
import { assistantDecisionInput, assistantMessageInput } from './admin-assistant-policy';

export const adminAssistantMessage = createServerFn({method:'POST'}).inputValidator(assistantMessageInput).handler(async ({data})=>{
  const {runAssistant,assistantError}=await import('./admin-assistant.server');
  try {return await runAssistant(data.pin,data.conversationId,[...data.messages],{context:data.context});}
  catch(error) {return {text:assistantError(error)};}
});
export const adminAssistantDecision = createServerFn({method:'POST'}).inputValidator(assistantDecisionInput).handler(async ({data})=>{
  const {decideAssistantOperation,assistantError}=await import('./admin-assistant.server');
  try {return await decideAssistantOperation(data.pin,data.id,data.decision);}
  catch(error) {return {text:assistantError(error)};}
});