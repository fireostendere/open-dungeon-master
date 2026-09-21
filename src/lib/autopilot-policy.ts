export function mayChangeAutopilot(input: {
  actorUserId: string;
  targetUserId: string;
  enable: boolean;
  isLead: boolean;
  isDm: boolean;
}): boolean {
  const self = input.actorUserId === input.targetUserId;
  if (input.enable) return self;
  return self || input.isLead || input.isDm;
}
