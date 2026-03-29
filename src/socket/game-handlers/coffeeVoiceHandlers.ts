/**
 * Coffee Roulette voice call modals and WebRTC signaling handlers.
 *
 * This file now re-exports from split sub-modules for backward compatibility.
 * See coffeeVoiceCallHandlers.ts and coffeeWebRTCHandlers.ts for implementations.
 */
import type { GameHandlerContext } from './handlerContext';
import { registerCoffeeVoiceCallHandlers } from './coffeeVoiceCallHandlers';
import { registerCoffeeWebRTCHandlers } from './coffeeWebRTCHandlers';

export function registerCoffeeVoiceHandlers(ctx: GameHandlerContext): void {
  registerCoffeeVoiceCallHandlers(ctx);
  registerCoffeeWebRTCHandlers(ctx);
}
