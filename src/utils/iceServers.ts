/**
 * Build ICE server config for WebRTC (STUN + optional TURN).
 * Shared by getIceServers (auth) and getIceServersPublic (testing).
 */
export function buildIceServersConfig(): Array<{ urls: string | string[]; username?: string; credential?: string }> {
  const stunUrls = (process.env.WEBRTC_STUN_URLS || 'stun:stun.l.google.com:19302')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: stunUrls },
  ];

  const turnUrl = process.env.WEBRTC_TURN_URL;
  const turnUsername = process.env.WEBRTC_TURN_USERNAME;
  const turnCredential = process.env.WEBRTC_TURN_CREDENTIAL;

  if (turnUrl) {
    if (!turnUsername || !turnCredential) {
      throw new Error('TURN credentials are not configured');
    }
    iceServers.push({
      urls: [turnUrl],
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return iceServers;
}
