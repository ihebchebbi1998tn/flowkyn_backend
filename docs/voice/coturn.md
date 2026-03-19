## coturn (TURN) for Coffee Roulette voice mode

This app uses **WebRTC audio-only** for Coffee Roulette voice.
Your backend is used only for **signaling** (socket.io forwarding). Media is sent P2P when possible; when NAT traversal needs help, it relays via TURN.

### What to run (free)
- Install [`coturn`](https://github.com/coturn/coturn) on your VPS.
- Configure it to listen on TURN ports and (optionally) support TLS.

### Recommended ports
- UDP `3478` (standard TURN)
- TCP `3478` (optional)
- Optional TLS: TCP `5349`

### Basic configuration (high level)
1. Create a TURN config file (example: `/etc/turnserver.conf`).
2. Set:
   - `listening-port=3478`
   - `listening-ip=0.0.0.0`
   - `fingerprint`
   - `lt-cred-mech` (auth with username/password)
   - `realm=<your-domain>`
3. Provide authentication secrets:
   - Either:
     - static `user=...` / `pass=...` (simpler, less secure), or
     - a mechanism with generated short-lived credentials (more secure).

### Credentials strategy (important)
- For simplicity, you can start with **static TURN credentials** from environment variables.
- For production-grade security, implement short-lived TURN credentials on the backend (still using coturn free software).

### Firewall / cloud security group
Open the TURN ports on:
- VPS firewall (ufw/iptables/etc.)
- cloud provider security group

You must allow at least UDP `3478` inbound from the public internet.

### Deploy verification checklist
1. Start coturn and confirm logs show listeners are bound.
2. In a browser session, when voice is enabled, verify:
   - ICE state reaches `connected` or `completed`.
   - If it falls back to TURN, media still flows.
3. If ICE fails, check:
   - TURN ports open (UDP first)
   - coturn realm/credentials match what the frontend/endpoint returns

### Next integration step in this repo
Once coturn is configured, we will expose `iceServers` to the frontend (STUN + TURN) via a backend endpoint and let WebRTC use it.

