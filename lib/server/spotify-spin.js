'use strict';

/**
 * Spotify Spin Class Generator
 *
 * Handles Spotify OAuth and generates spin class plans from playlist audio features.
 *
 * Required environment variables:
 *   SPOTIFY_CLIENT_ID     - Your Spotify app client ID
 *   SPOTIFY_CLIENT_SECRET - Your Spotify app client secret
 *   SPOTIFY_REDIRECT_URI  - OAuth callback URL (e.g. http://localhost:1337/spinclass/callback)
 */

const express = require('express');
const https = require('https');
const querystring = require('querystring');

// ---------------------------------------------------------------------------
// Spin class phase definitions
// Each track is slotted into a phase based on its audio features.
// ---------------------------------------------------------------------------
const PHASES = [
  {
    name: 'Warm Up',
    icon: '🌅',
    targetEnergy: 0.35,
    targetTempo: 80,
    resistance: 'Low (1-3)',
    cadence: '70-80 RPM',
    position: 'Seated flat',
    description: 'Easy spin to get the legs moving and heart rate rising gradually.',
    durationShare: 0.12   // ~12 % of total class time
  },
  {
    name: 'Build',
    icon: '📈',
    targetEnergy: 0.55,
    targetTempo: 100,
    resistance: 'Moderate (4-6)',
    cadence: '80-90 RPM',
    position: 'Seated climb',
    description: 'Increase resistance and cadence – start feeling the burn.',
    durationShare: 0.15
  },
  {
    name: 'Peak Interval',
    icon: '⚡',
    targetEnergy: 0.85,
    targetTempo: 140,
    resistance: 'High (7-9)',
    cadence: '90-110 RPM',
    position: 'Standing sprint',
    description: 'All-out effort! Push to your maximum for the length of the track.',
    durationShare: 0.18
  },
  {
    name: 'Recovery',
    icon: '💧',
    targetEnergy: 0.40,
    targetTempo: 90,
    resistance: 'Low-Moderate (2-4)',
    cadence: '75-85 RPM',
    position: 'Seated flat',
    description: 'Back off – active recovery. Catch your breath.',
    durationShare: 0.10
  },
  {
    name: 'Hill Climb',
    icon: '⛰️',
    targetEnergy: 0.70,
    targetTempo: 110,
    resistance: 'High (7-8)',
    cadence: '70-80 RPM',
    position: 'Standing climb',
    description: 'Heavy resistance, controlled pace. Power up the mountain.',
    durationShare: 0.15
  },
  {
    name: 'Sprint',
    icon: '🏃',
    targetEnergy: 0.90,
    targetTempo: 160,
    resistance: 'Moderate (4-5)',
    cadence: '100-120 RPM',
    position: 'Seated sprint',
    description: 'Fast legs, light resistance. Speed is everything here.',
    durationShare: 0.15
  },
  {
    name: 'Cool Down',
    icon: '🧘',
    targetEnergy: 0.25,
    targetTempo: 70,
    resistance: 'Very Low (1-2)',
    cadence: '60-70 RPM',
    position: 'Seated flat',
    description: 'Easy spin to bring heart rate down. Breathe and recover.',
    durationShare: 0.15
  }
];

// ---------------------------------------------------------------------------
// Helpers – Spotify HTTP calls (no third-party SDK needed)
// ---------------------------------------------------------------------------

function spotifyGet (path, accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.spotify.com',
      path,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + accessToken }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON from Spotify: ' + body)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function spotifyPost (path, postData) {
  return new Promise((resolve, reject) => {
    const data = querystring.stringify(postData);
    const options = {
      hostname: 'accounts.spotify.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        Authorization: 'Basic ' + Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
        ).toString('base64')
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON from Spotify: ' + body)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Spin class generation algorithm
// ---------------------------------------------------------------------------

/**
 * Score how well a track fits a phase (lower = better match).
 */
function phaseScore (features, phase) {
  const energyDiff  = Math.abs(features.energy  - phase.targetEnergy);
  const tempoDiff   = Math.abs(features.tempo    - phase.targetTempo) / 200; // normalise
  return energyDiff + tempoDiff;
}

/**
 * Given a list of tracks with Spotify audio features, assign each track to a
 * spin class phase and return the ordered class plan.
 *
 * Strategy:
 *  1. Sort phases by target energy to define the arc of the class.
 *  2. For each phase slot, greedily pick the unassigned track that best fits.
 */
function generateSpinClass (tracksWithFeatures) {
  const available = tracksWithFeatures.slice(); // shallow copy – we'll splice from it

  // Build a phase order that follows a real spin class arc:
  // warmup → build → peak → recovery → hill → sprint → cooldown
  const phaseOrder = [0, 1, 2, 3, 4, 5, 2, 3, 6]; // indices into PHASES array

  const plan = [];
  for (const phaseIdx of phaseOrder) {
    if (available.length === 0) break;
    const phase = PHASES[phaseIdx];

    // Find the best-matching track
    let bestIdx = 0;
    let bestScore = Infinity;
    available.forEach((track, i) => {
      const score = phaseScore(track.features, phase);
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    });

    const chosen = available.splice(bestIdx, 1)[0];
    const bpm    = Math.round(chosen.features.tempo);
    const energy = Math.round(chosen.features.energy * 100);

    plan.push({
      phase:       phase.name,
      icon:        phase.icon,
      resistance:  phase.resistance,
      cadence:     phase.cadence,
      position:    phase.position,
      instruction: phase.description,
      track: {
        name:     chosen.track.name,
        artist:   (chosen.track.artists || []).map(a => a.name).join(', '),
        duration: msToMinSec(chosen.track.duration_ms),
        bpm,
        energy,
        albumArt: (((chosen.track.album || {}).images || [])[2] || {}).url || null
      }
    });
  }

  return plan;
}

function msToMinSec (ms) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Express router
// ---------------------------------------------------------------------------

function create (env) {
  const router = express.Router();

  const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
  const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
  const REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI || (
    (env.baseUrl || 'http://localhost:1337') + '/spinclass/callback'
  );

  const SCOPE = [
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-read-private'
  ].join(' ');

  // ── GET /spinclass  ────────────────────────────────────────────────────────
  // Serve the main HTML page (static file registered separately in app.js).
  // This endpoint just redirects there.
  router.get('/', (req, res) => {
    res.redirect('/spinclassindex.html');
  });

  // ── GET /spinclass/auth  ───────────────────────────────────────────────────
  // Kick off the Spotify OAuth flow.
  router.get('/auth', (req, res) => {
    if (!CLIENT_ID) {
      return res.status(500).json({ error: 'SPOTIFY_CLIENT_ID not configured' });
    }
    const params = querystring.stringify({
      response_type: 'code',
      client_id:     CLIENT_ID,
      scope:         SCOPE,
      redirect_uri:  REDIRECT_URI
    });
    res.redirect('https://accounts.spotify.com/authorize?' + params);
  });

  // ── GET /spinclass/callback  ───────────────────────────────────────────────
  // Spotify sends the user back here with a `code`.  Exchange it for tokens
  // and redirect to the UI with the access token in the fragment.
  router.get('/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error || !code) {
      return res.redirect('/spinclassindex.html?error=' + encodeURIComponent(error || 'no_code'));
    }
    try {
      const tokenData = await spotifyPost('/api/token', {
        grant_type:   'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      });
      if (tokenData.error) {
        return res.redirect('/spinclassindex.html?error=' + encodeURIComponent(tokenData.error));
      }
      // Pass tokens to the SPA via the URL fragment (never stored server-side)
      const fragment = querystring.stringify({
        access_token:  tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in:    tokenData.expires_in
      });
      res.redirect('/spinclassindex.html#' + fragment);
    } catch (err) {
      console.error('[spotify-spin] callback error', err);
      res.redirect('/spinclassindex.html?error=token_exchange_failed');
    }
  });

  // ── GET /spinclass/playlists  ──────────────────────────────────────────────
  // Return the current user's playlists.
  router.get('/playlists', async (req, res) => {
    const token = req.headers['x-spotify-token'];
    if (!token) return res.status(401).json({ error: 'Missing X-Spotify-Token header' });
    try {
      const data = await spotifyGet('/v1/me/playlists?limit=50', token);
      if (data.error) return res.status(data.error.status || 400).json(data);
      res.json(data);
    } catch (err) {
      console.error('[spotify-spin] playlists error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /spinclass/generate  ──────────────────────────────────────────────
  // Body: { playlistId: "...", accessToken: "..." }
  // Returns a full spin class plan.
  router.post('/generate', express.json(), async (req, res) => {
    const { playlistId, accessToken } = req.body || {};
    if (!playlistId || !accessToken) {
      return res.status(400).json({ error: 'playlistId and accessToken are required' });
    }

    try {
      // 1. Fetch playlist tracks (up to 50)
      const tracksData = await spotifyGet(
        `/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=50&fields=items(track(id,name,duration_ms,artists,album))`,
        accessToken
      );
      if (tracksData.error) return res.status(tracksData.error.status || 400).json(tracksData);

      const tracks = (tracksData.items || [])
        .map(i => i.track)
        .filter(t => t && t.id);   // skip null tracks (e.g. local files)

      if (tracks.length < 3) {
        return res.status(400).json({ error: 'Playlist needs at least 3 tracks to generate a class.' });
      }

      // 2. Fetch audio features in one batch call
      const ids = tracks.map(t => t.id).join(',');
      const featuresData = await spotifyGet(`/v1/audio-features?ids=${ids}`, accessToken);
      if (featuresData.error) return res.status(featuresData.error.status || 400).json(featuresData);

      const featureMap = {};
      (featuresData.audio_features || []).forEach(f => {
        if (f) featureMap[f.id] = f;
      });

      const tracksWithFeatures = tracks
        .filter(t => featureMap[t.id])
        .map(t => ({ track: t, features: featureMap[t.id] }));

      if (tracksWithFeatures.length < 3) {
        return res.status(400).json({ error: 'Could not retrieve audio features for enough tracks.' });
      }

      // 3. Generate the class plan
      const plan = generateSpinClass(tracksWithFeatures);
      const totalTracks = plan.length;
      const totalMins   = plan.reduce((sum, slot) => {
        const [m, s] = slot.track.duration.split(':').map(Number);
        return sum + m + s / 60;
      }, 0);

      res.json({
        plan,
        summary: {
          totalTracks,
          totalDuration: Math.round(totalMins) + ' min',
          phases: [...new Set(plan.map(s => s.phase))]
        }
      });
    } catch (err) {
      console.error('[spotify-spin] generate error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = create;
