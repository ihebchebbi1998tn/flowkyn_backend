/**
 * Games Service — Facade
 *
 * Extends StrategicEscapeService (which extends GameSessionCoreService)
 * to maintain the single GamesService class API for backward compatibility.
 */
import { StrategicEscapeService } from './strategicEscape.service';

export class GamesService extends StrategicEscapeService {}
