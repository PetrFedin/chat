(() => {
  const LK = window.LivekitClient;
  const state = {
    room: null,
    call: null,
    mode: 'video',
    mic: true,
    camera: true,
    screen: false,
    recording: false,
    leaving: false,
    joining: false,
  };

  const esc = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.body ? { 'content-type':'application/json' } : {}), ...(options.headers || {}) },
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
      error.code = payload?.error?.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  };

  const initials = (name = '?') => name.split(/\s+/).filter(Boolean).slice(0,2).map((part) => part[0]?.toUpperCase()).join('') || '?';

  function status(message, error = false) {
    let node = document.querySelector('.call-status');
    if (!node) {
      node = document.createElement('div');
      node.className = 'call-status';
      document.body.append(node);
    }
    node.classList.toggle('error', error);
    node.textContent = message;
    clearTimeout(status.timer);
    status.timer = setTimeout(() => node.remove(), error ? 5000 : 2200);
  }

  function incomingCall(payload) {
    const callId = String(payload?.url ?? '').match(/#\/calls\/([0-9a-f-]+)/i)?.[1];
    if (!callId || state.call?.id === callId) return;
    document.querySelector('.incoming-call')?.remove();
    const root = document.createElement('div');
    root.className = 'incoming-call';
    root.innerHTML = `<div><strong>${esc(payload.title || 'Входящий звонок')}</strong><span>${esc(payload.body || 'Корпоративный звонок')}</span></div><div class="incoming-actions"><button data-call-answer>Войти</button><button class="dismiss" data-call-dismiss>Не сейчас</button></div>`;
    document.body.append(root);
    root.querySelector('[data-call-dismiss]').onclick = () => root.remove();
    root.querySelector('[data-call-answer]').onclick = () => {
      root.remove();
      history.replaceState(null, '', `/#/calls/${callId}`);
      joinExisting(callId).catch((error) => status(error.message, true));
    };
  }

  function overlay(call) {
    document.querySelector('.incoming-call')?.remove();
    document.querySelector('.call-overlay')?.remove();
    const root = document.createElement('section');
    root.className = 'call-overlay';
    root.innerHTML = `
      <header class="call-topbar">
        <div class="call-title"><strong>${esc(call.title || (call.mode === 'audio' ? 'Аудиозвонок' : 'Видеозвонок'))}</strong><span id="call-subtitle">Подключение…</span></div>
        <span class="call-live">LIVE</span>
      </header>
      <div id="call-stage" class="call-stage"><div class="call-empty">Подключаем защищённую медиасессию…</div></div>
      <div class="call-controls-wrap"><div class="call-controls">
        <button class="call-control" data-call-control="mic" aria-label="Микрофон">◖</button>
        <button class="call-control" data-call-control="camera" aria-label="Камера">◉</button>
        <button class="call-control" data-call-control="screen" aria-label="Демонстрация экрана">▣</button>
        <button class="call-control" data-call-control="record" aria-label="Запись">●</button>
        <button class="call-control danger" data-call-control="leave" aria-label="Завершить">×</button>
      </div></div>`;
    document.body.append(root);
    root.querySelectorAll('[data-call-control]').forEach((button) => button.addEventListener('click', () => control(button.dataset.callControl)));
    syncControls();
    return root;
  }

  function tileId(identity) {
    return `call-participant-${String(identity).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  function participantTile(participant, local = false) {
    const stage = document.querySelector('#call-stage');
    if (!stage) return null;
    stage.querySelector('.call-empty')?.remove();
    let tile = document.getElementById(tileId(participant.identity));
    if (!tile) {
      tile = document.createElement('div');
      tile.id = tileId(participant.identity);
      tile.className = 'participant-tile';
      tile.dataset.identity = participant.identity;
      const display = participant.name || (local ? 'Вы' : participant.identity);
      tile.innerHTML = `<div class="participant-fallback">${esc(initials(display))}</div><div class="participant-label"><span>${esc(display)}</span><span class="muted-icon" data-media-state></span></div>`;
      if (local) stage.prepend(tile); else stage.append(tile);
    }
    updateParticipantLabel(participant, tile);
    return tile;
  }

  function updateParticipantLabel(participant, tile = participantTile(participant)) {
    if (!tile) return;
    const stateNode = tile.querySelector('[data-media-state]');
    if (stateNode) stateNode.textContent = `${participant.isMicrophoneEnabled ? '' : '⌁'}${participant.isCameraEnabled ? '' : ' ◉̸'}`.trim();
  }

  function attachTrack(track, participant) {
    const tile = participantTile(participant);
    if (!tile) return;
    const element = track.attach();
    if (track.kind === LK.Track.Kind.Video) {
      tile.querySelectorAll('video').forEach((node) => node.remove());
      element.playsInline = true;
      element.autoplay = true;
      tile.prepend(element);
    } else {
      element.autoplay = true;
      document.querySelector('.call-overlay')?.append(element);
    }
    updateParticipantLabel(participant, tile);
  }

  function renderLocalTracks() {
    if (!state.room) return;
    const participant = state.room.localParticipant;
    const tile = participantTile(participant, true);
    const publication = participant.getTrackPublication(LK.Track.Source.Camera);
    if (publication?.track) attachTrack(publication.track, participant);
    else tile?.querySelectorAll('video').forEach((node) => node.remove());
    updateParticipantLabel(participant, tile);
  }

  function syncControls() {
    const root = document.querySelector('.call-overlay');
    if (!root) return;
    root.querySelector('[data-call-control="mic"]')?.classList.toggle('off', !state.mic);
    root.querySelector('[data-call-control="camera"]')?.classList.toggle('off', !state.camera);
    root.querySelector('[data-call-control="screen"]')?.classList.toggle('off', !state.screen);
    root.querySelector('[data-call-control="record"]')?.classList.toggle('recording', state.recording);
    const camera = root.querySelector('[data-call-control="camera"]');
    if (camera) camera.disabled = state.mode === 'audio';
  }

  async function reportMedia(extra = {}) {
    if (!state.call) return;
    await api(`/api/v1/calls/${state.call.id}/media`, { method:'PATCH', body:JSON.stringify({
      audioEnabled: state.mic,
      videoEnabled: state.camera,
      screenSharing: state.screen,
      ...extra,
    }) }).catch(() => {});
  }

  async function control(type) {
    if (!state.room || !state.call) return;
    try {
      if (type === 'mic') {
        state.mic = !state.mic;
        await state.room.localParticipant.setMicrophoneEnabled(state.mic);
        await reportMedia();
      } else if (type === 'camera') {
        state.camera = !state.camera;
        await state.room.localParticipant.setCameraEnabled(state.camera);
        renderLocalTracks();
        await reportMedia();
      } else if (type === 'screen') {
        state.screen = !state.screen;
        await state.room.localParticipant.setScreenShareEnabled(state.screen, state.screen ? { audio:true } : undefined);
        await reportMedia();
      } else if (type === 'record') {
        const consent = await api(`/api/v1/calls/${state.call.id}/recording-consent`, { method:'POST', body:'{}' });
        if (!consent.consentReady) {
          status('Согласие отправлено. Ждём остальных участников.');
        } else if (!state.recording) {
          try {
            await api(`/api/v1/calls/${state.call.id}/recording/start`, { method:'POST', body:'{}' });
            state.recording = true;
            status('Запись встречи началась');
          } catch (error) {
            if (error.status === 403) status('Все согласия получены. Запись может запустить руководитель.', false);
            else throw error;
          }
        } else {
          await api(`/api/v1/calls/${state.call.id}/recording/stop`, { method:'POST', body:'{}' });
          state.recording = false;
          status('Запись остановлена и обрабатывается');
        }
      } else if (type === 'leave') {
        await leave();
        return;
      }
      syncControls();
    } catch (error) {
      if (type === 'screen') state.screen = false;
      status(error.message || 'Не удалось изменить состояние звонка', true);
      syncControls();
    }
  }

  function bindRoom(room) {
    room
      .on(LK.RoomEvent.TrackSubscribed, (track, publication, participant) => attachTrack(track, participant))
      .on(LK.RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => element.remove()))
      .on(LK.RoomEvent.ParticipantConnected, (participant) => participantTile(participant))
      .on(LK.RoomEvent.ParticipantDisconnected, (participant) => document.getElementById(tileId(participant.identity))?.remove())
      .on(LK.RoomEvent.ActiveSpeakersChanged, (participants) => {
        const active = new Set(participants.map((participant) => participant.identity));
        document.querySelectorAll('.participant-tile').forEach((tile) => tile.classList.toggle('speaking', active.has(tile.dataset.identity)));
      })
      .on(LK.RoomEvent.Reconnecting, () => {
        document.querySelector('#call-subtitle').textContent = 'Восстанавливаем связь…';
        reportMedia({ connectionState:'reconnecting' });
      })
      .on(LK.RoomEvent.Reconnected, () => {
        document.querySelector('#call-subtitle').textContent = 'Связь восстановлена';
        reportMedia({ connectionState:'connected' });
      })
      .on(LK.RoomEvent.Disconnected, () => {
        if (!state.leaving) status('Соединение завершено');
      })
      .on(LK.RoomEvent.LocalTrackPublished, renderLocalTracks)
      .on(LK.RoomEvent.LocalTrackUnpublished, renderLocalTracks)
      .on(LK.RoomEvent.TrackMuted, (_, participant) => updateParticipantLabel(participant))
      .on(LK.RoomEvent.TrackUnmuted, (_, participant) => updateParticipantLabel(participant));
  }

  async function connectCall(call, credentials) {
    if (!LK?.Room) throw new Error('LiveKit client SDK is not available');
    state.call = call;
    state.mode = call.mode;
    state.camera = call.mode !== 'audio';
    state.mic = true;
    state.screen = false;
    state.recording = call.recordingStatus === 'recording';
    overlay(call);
    const room = new LK.Room({ adaptiveStream:true, dynacast:true });
    state.room = room;
    bindRoom(room);
    room.prepareConnection(credentials.serverUrl, credentials.participantToken);
    await reportMedia({ connectionState:'connecting' });
    await room.connect(credentials.serverUrl, credentials.participantToken);
    participantTile(room.localParticipant, true);
    document.querySelector('#call-subtitle').textContent = 'Подключено';
    await room.startAudio().catch(() => {});
    await room.localParticipant.setMicrophoneEnabled(true);
    if (state.camera) await room.localParticipant.setCameraEnabled(true);
    renderLocalTracks();
    room.remoteParticipants.forEach((participant) => participantTile(participant));
    await reportMedia({ connectionState:'connected' });
    syncControls();
  }

  async function startOutgoing(mode) {
    if (state.room || state.joining) return;
    const selected = document.querySelector('.conversation-card.active[data-conversation]')?.dataset.conversation
      || document.querySelector('.sidebar-row.active[data-conversation]')?.dataset.conversation;
    if (!selected) throw new Error('Сначала откройте диалог или канал');
    state.joining = true;
    try {
      const created = await api(`/api/v1/conversations/${selected}/calls`, { method:'POST', body:JSON.stringify({ mode }) });
      const joined = await api(`/api/v1/calls/${created.call.id}/join`, { method:'POST', body:'{}' });
      await connectCall(joined.call, joined.credentials);
      history.replaceState(null, '', `/#/calls/${joined.call.id}`);
    } finally { state.joining = false; }
  }

  async function joinExisting(callId) {
    if (!callId || state.room || state.joining) return;
    state.joining = true;
    try {
      const current = await api(`/api/v1/calls/${callId}`);
      const joined = await api(`/api/v1/calls/${callId}/join`, { method:'POST', body:'{}' });
      await connectCall(joined.call || current.call, joined.credentials);
    } finally { state.joining = false; }
  }

  async function leave() {
    if (!state.call || state.leaving) return;
    state.leaving = true;
    const callId = state.call.id;
    try { await state.room?.disconnect(); } catch {}
    await api(`/api/v1/calls/${callId}/leave`, { method:'POST', body:'{}' }).catch(() => {});
    document.querySelector('.call-overlay')?.remove();
    document.querySelector('.call-status')?.remove();
    state.room = null; state.call = null; state.leaving = false; state.recording = false;
    if (location.hash.startsWith('#/calls/')) history.replaceState(null, '', location.pathname + location.search + '#/chats');
  }

  function callIdFromHash() {
    return location.hash.match(/^#\/calls\/([0-9a-f-]+)$/i)?.[1] || null;
  }

  function resumeHashCall() {
    const callId = callIdFromHash();
    const app = document.querySelector('#app-view');
    if (!callId || state.room || state.joining || !app || app.hidden) return;
    joinExisting(callId).catch((error) => {
      if (error.status !== 401) status(error.message, true);
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="audio"],[data-action="video"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startOutgoing(button.dataset.action === 'audio' ? 'audio' : 'video').catch((error) => status(error.message, true));
  }, true);

  window.addEventListener('hashchange', resumeHashCall);
  window.addEventListener('beforeunload', () => {
    if (state.call && !state.leaving) navigator.sendBeacon(`/api/v1/calls/${state.call.id}/leave`, new Blob(['{}'], { type:'application/json' }));
  });

  const appView = document.querySelector('#app-view');
  if (appView) new MutationObserver(resumeHashCall).observe(appView, { attributes:true, attributeFilter:['hidden'] });
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type === 'chat.push') incomingCall(event.data.payload);
  });

  window.ChatCalls = { startOutgoing, joinExisting, leave, notifyIncoming:incomingCall, resumeHashCall, state };
  setTimeout(resumeHashCall, 250);
})();
