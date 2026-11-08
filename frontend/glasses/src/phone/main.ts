import { PhoneQuestionRecorder } from './audio';

type Assignment = { id: number | string; status: string; lease_seconds: number | null };
type Target = { id: number | string; lat: number; lon: number; critical_level: string; critical_score: number; house_label: string; location_note: string };
type PhoneState = { type: 'phone_state'; assignment: Assignment | null; target: Target | null; rescuer_position?: { lat: number; lon: number }; demo_mode?: boolean; plugin_connected?: boolean };
type ResolvedPhoneState = PhoneState & { assignment: Assignment | null; target: Target | null };

const params = new URLSearchParams(location.search);
const rescuer = params.get('rescuer') ?? 'default';
const rescuerPath = encodeURIComponent(rescuer);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const linkState = $('link-state');
const gpsState = $('gps-state');
const connectionDetail = $('connection-detail');
const targetHeading = $('target-heading');
const targetDetail = $('target-detail');
const targetPriority = $('target-priority');
const targetDistance = $('target-distance');
const proposalPanel = $('proposal-panel');
const assignmentPanel = $('assignment-panel');
const proposalCountdown = $('proposal-countdown');
const assignmentState = $('assignment-state');
const notice = $('notice');
const askButton = $('ask-button') as HTMLButtonElement;
const askHelp = $('ask-help');
const resolveDialog = $('resolve-dialog') as HTMLDialogElement;
const resolveForm = $('resolve-form') as HTMLFormElement;

let ws: WebSocket | undefined;
let retryTimer: number | undefined;
let heartbeatTimer: number | undefined;
let geoWatch: number | undefined;
let phonePosition: { lat: number; lon: number; accuracy: number } | undefined;
let recentFixes: Array<{ lat: number; lon: number; accuracy: number }> = [];
let state: ResolvedPhoneState = { type: 'phone_state', assignment: null, target: null };
let leaseReceivedAt = Date.now();
let recorder: PhoneQuestionRecorder | undefined;

function socketAddress(): string {
  const url = new URL('/phone', location.href);
  url.searchParams.set('rescuer', rescuer);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function connect(): void {
  clearTimeout(retryTimer);
  linkState.textContent = 'Connecting';
  linkState.dataset.state = 'connecting';
  ws = new WebSocket(socketAddress());
  ws.onopen = () => {
    linkState.textContent = 'Connected';
    linkState.dataset.state = 'open';
    connectionDetail.textContent = `Rescuer session: ${rescuer}`;
    ws?.send(JSON.stringify({ type: 'heartbeat' }));
    clearInterval(heartbeatTimer);
    heartbeatTimer = window.setInterval(() => ws?.send(JSON.stringify({ type: 'heartbeat' })), 5000);
  };
  ws.onmessage = event => {
    if (typeof event.data !== 'string') return;
    try {
      const value = JSON.parse(event.data) as Partial<PhoneState>;
      if (value.type !== 'phone_state') return;
      state = { type: 'phone_state', assignment: value.assignment ?? null, target: value.target ?? null, rescuer_position: value.rescuer_position, demo_mode: value.demo_mode, plugin_connected: value.plugin_connected };
      leaseReceivedAt = Date.now();
      render();
    } catch { setNotice('Received an invalid session update.', 'error'); }
  };
  ws.onerror = () => { linkState.textContent = 'Connection issue'; linkState.dataset.state = 'error'; };
  ws.onclose = () => {
    clearInterval(heartbeatTimer);
    linkState.textContent = 'Reconnecting';
    linkState.dataset.state = 'retrying';
    retryTimer = window.setTimeout(connect, 1000);
  };
}

function render(): void {
  const assignment = state.assignment;
  const target = state.target;
  const status = assignment?.status.toLowerCase() ?? 'idle';
  const proposed = status === 'proposed';
  const active = ['active', 'en_route', 'reached'].includes(status);
  proposalPanel.hidden = !proposed;
  assignmentPanel.hidden = !active;
  if (proposed) {
    const lease = assignment?.lease_seconds;
    const remaining = lease === null || lease === undefined ? null : Math.max(0, lease - Math.floor((Date.now() - leaseReceivedAt) / 1000));
    proposalCountdown.textContent = remaining === null ? 'Assignment proposal' : `Accept or decline - ${remaining}s left`;
  }
  assignmentState.textContent = `Assignment ${status.replaceAll('_', ' ')}`;
  $('accept-button').toggleAttribute('disabled', !proposed);
  $('decline-button').toggleAttribute('disabled', !proposed);
  $('release-button').toggleAttribute('disabled', !active);
  $('reached-button').toggleAttribute('disabled', !['active', 'en_route'].includes(status));
  $('resolve-button').toggleAttribute('disabled', status !== 'reached');

  if (target) {
    targetHeading.textContent = target.house_label || `Survivor ${target.id}`;
    targetDetail.textContent = target.location_note || 'No location note';
    const level = target.critical_level.toLowerCase();
    targetPriority.textContent = `${level.toUpperCase()} - score ${Math.round(target.critical_score)}`;
    targetPriority.dataset.level = level;
    targetDistance.textContent = distanceLabel(target);
  } else {
    targetHeading.textContent = 'No active assignment';
    targetDetail.textContent = 'Waiting for an assignment.';
    targetPriority.textContent = 'No target';
    targetPriority.dataset.level = 'unknown';
    targetDistance.textContent = 'Distance unavailable';
  }
  askHelp.textContent = state.plugin_connected
    ? 'The question will use the glasses microphone.'
    : 'No glasses plugin is connected. The phone will record up to 8 seconds.';
  if (!recorder?.isRecording()) askButton.textContent = 'Ask';
}

function distanceLabel(target: Target): string {
  const from = state.demo_mode ? state.rescuer_position : phonePosition ?? state.rescuer_position;
  if (!from) return state.demo_mode ? 'Demo position unavailable' : 'Waiting for GPS';
  const meters = distanceMeters(from, target);
  return `${Math.round(meters)} m away`;
}

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function postAction(action: string, fields: Record<string, unknown> = {}): Promise<boolean> {
  try {
    const response = await fetch(`/rescuer/${rescuerPath}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...fields }) });
    const result = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error ?? `Action failed (${response.status}).`);
    setNotice(`${action.replaceAll('_', ' ')} sent.`, 'success');
    return true;
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'Action failed.', 'error');
    return false;
  }
}

function bindAction(id: string, action: string, valueName?: 'assignment_id' | 'survivor_id'): void {
  $(id).addEventListener('click', () => {
    const value = valueName === 'assignment_id' ? state.assignment?.id : valueName === 'survivor_id' ? state.target?.id : undefined;
    if (valueName && value === undefined) { setNotice('No current assignment is available.', 'error'); return; }
    void postAction(action, valueName ? { [valueName]: value } : {});
  });
}

bindAction('accept-button', 'accept', 'assignment_id');
bindAction('decline-button', 'decline', 'assignment_id');
bindAction('release-button', 'release', 'assignment_id');
bindAction('reached-button', 'reached', 'survivor_id');
$('resolve-button').addEventListener('click', () => resolveDialog.showModal());
$('cancel-resolve').addEventListener('click', () => resolveDialog.close());
$('confirm-resolve').addEventListener('click', event => {
  event.preventDefault();
  if (!state.target) return;
  const resolution = ($<HTMLSelectElement>('resolution')).value;
  const note = ($<HTMLTextAreaElement>('resolution-note')).value;
  void postAction('resolve', { survivor_id: state.target.id, resolution, note }).then(ok => { if (ok) resolveDialog.close(); });
});

askButton.addEventListener('click', async () => {
  if (recorder?.isRecording()) { try { await recorder.finish(); } catch (error) { setNotice(String(error), 'error'); } return; }
  if (state.plugin_connected) {
    if (await postAction('ask')) setNotice('Listening on the glasses. Ask your question now.', 'success');
    return;
  }
  recorder = new PhoneQuestionRecorder({ maxSeconds: 8, onComplete: wav => { void uploadQuestion(wav); recorder = undefined; askButton.textContent = 'Ask'; }, onError: error => setNotice(error.message, 'error') });
  try {
    await recorder.start();
    askButton.textContent = 'Stop and send';
    setNotice('Recording on this phone - speak now.', '');
  } catch (error) {
    recorder = undefined;
    setNotice(error instanceof Error ? `Microphone unavailable: ${error.message}` : 'Phone microphone unavailable.', 'error');
  }
});

async function uploadQuestion(wav: Uint8Array): Promise<void> {
  try {
    const audioCopy = Uint8Array.from(wav);
    const response = await fetch(`/rescuer/${rescuerPath}/ask_audio`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: new Blob([audioCopy.buffer as ArrayBuffer], { type: 'audio/wav' }) });
    const result = await response.json() as { ok?: boolean; transcript?: string };
    if (!response.ok) throw new Error(`Question upload failed (${response.status}).`);
    setNotice(result.transcript ? `Heard: “${result.transcript}”` : 'Did not catch that - ask again.', result.transcript ? 'success' : 'error');
  } catch (error) { setNotice(error instanceof Error ? error.message : 'Question upload failed.', 'error'); }
}

function setNotice(message: string, kind: '' | 'success' | 'error'): void {
  notice.textContent = message;
  notice.dataset.kind = kind;
}

function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; }

function startLocation(): void {
  if (!navigator.geolocation) { gpsState.textContent = 'Location unavailable'; return; }
  if (!window.isSecureContext) { gpsState.textContent = 'Location requires the HTTPS phone server'; return; }
  gpsState.textContent = 'Waiting for GPS fix';
  geoWatch = navigator.geolocation.watchPosition(position => {
    const fix = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy };
    if (fix.accuracy > 30) { gpsState.textContent = `GPS accuracy ${Math.round(fix.accuracy)} m - waiting for a better fix`; return; }
    recentFixes = [...recentFixes, fix].slice(-3);
    phonePosition = { lat: median(recentFixes.map(value => value.lat)), lon: median(recentFixes.map(value => value.lon)), accuracy: median(recentFixes.map(value => value.accuracy)) };
    gpsState.textContent = `GPS fix - accuracy ${Math.round(phonePosition.accuracy)} m`;
    ws?.send(JSON.stringify({ type: 'position', lat: phonePosition.lat, lon: phonePosition.lon, accuracy_m: phonePosition.accuracy }));
    render();
  }, error => { gpsState.textContent = error.code === error.PERMISSION_DENIED ? 'Location permission denied' : 'GPS fix unavailable'; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
}

window.addEventListener('beforeunload', () => {
  clearTimeout(retryTimer);
  clearInterval(heartbeatTimer);
  if (geoWatch !== undefined) navigator.geolocation.clearWatch(geoWatch);
  ws?.close();
});

window.setInterval(() => { if (state.assignment?.status.toLowerCase() === 'proposed') render(); }, 1000);
connect();
startLocation();
render();
