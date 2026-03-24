export function isStrategicAction(actionType: string) {
  return (
    actionType === 'strategic:configure' ||
    actionType === 'strategic:assign_roles' ||
    actionType === 'strategic:start_discussion' ||
    actionType === 'strategic:end_discussion'
  );
}
