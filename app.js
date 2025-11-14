(function(){
  const $ = (sel, parent=document) => parent.querySelector(sel);
  const $$ = (sel, parent=document) => [...parent.querySelectorAll(sel)];

  // Demo data
  const onlineVideos = [
    { id: 'live-1', title: '수학 라이브: 미적분 기초', src: 'https://www.w3schools.com/html/mov_bbb.mp4', live: true },
    { id: 'live-2', title: '물리 라이브: 역학 개론', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', live: true },
    { id: 'live-hls-1', title: '라이브 스트림 (HLS 샘플)', src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', live: true },
  ];
  const offlineVideos = [
    { id: 'rec-1', title: '프로그래밍 입문 1강', src: 'https://www.w3schools.com/html/mov_bbb.mp4' },
    { id: 'rec-2', title: '프로그래밍 입문 2강', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' },
  ];

  // In-memory Q&A threads: { [videoId]: [{author, text, ts}] }
  const threads = {};
  let currentMode = 'home'; // 'online' | 'offline'
  let currentVideo = null;  // {id, title, src}
  let hlsPlayer = null;     // hls.js instance
  // PeerJS state (for WebRTC)
  let roomCode = '';
  let localStream = null;
  let peer = null;          // PeerJS Peer 인스턴스
  let currentCall = null;   // 현재 활성화된 호출

  function isHls(src){
    return /\.m3u8(\?|$)/i.test(src);
  }

  function destroyHls(){
    if(hlsPlayer){
      try{ hlsPlayer.destroy(); }catch(e){}
      hlsPlayer = null;
    }
  }

  function playSource(videoEl, src){
    // If HLS and hls.js is available, use it; otherwise rely on native playback
    if (typeof Hls !== 'undefined' && Hls.isSupported() && isHls(src)) {
      destroyHls();
      hlsPlayer = new Hls();
      hlsPlayer.loadSource(src);
      hlsPlayer.attachMedia(videoEl);
      hlsPlayer.on(Hls.Events.MANIFEST_PARSED, ()=>{
        videoEl.play().catch(()=>{});
      });
    } else {
      // Safari (native HLS) or MP4
      destroyHls();
      videoEl.src = src;
      videoEl.play().catch(()=>{});
    }
  }

  function showView(id){
    $$('.view').forEach(v=>v.classList.remove('active'));
    $('#'+id).classList.add('active');
  }

  function initLanding(){
    $('#btn-online').addEventListener('click', ()=>{
      currentMode = 'online';
      renderMode('online');
    });
    $('#btn-offline').addEventListener('click', ()=>{
      currentMode = 'offline';
      renderMode('offline');
    });
  }

  function renderMode(mode){
    showView(mode);
    $(`#${mode} .toolbar [data-nav="home"]`).onclick = ()=>{
      currentMode='home';
      currentVideo=null;
      destroyHls();
      cleanupWebRTC();
      showView('landing');
    };

    const listEl = $(`#${mode}-list`);
    listEl.innerHTML = '';

    const data = mode==='online' ? onlineVideos : offlineVideos;
    data.forEach(item=>{
      const el = document.createElement('div');
      el.className = 'item';
      el.setAttribute('role','button');
      el.setAttribute('tabindex','0');
      el.innerHTML = `
        <div class="meta">
          <p class="title">${item.title}</p>
          <span class="badge ${mode==='online' ? 'live' : 'vod'}">${mode==='online' ? 'Live' : 'VOD'}</span>
        </div>
      `;
      el.addEventListener('click', ()=> selectVideo(mode, item));
      el.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); selectVideo(mode,item);} });
      listEl.appendChild(el);
    });

    // Reset player area
    const videoEl = $(`#${mode}-video`);
    const titleEl = $(`#${mode}-title`);
    const qaBtn = $(`#${mode}-qa`);
    destroyHls();
    videoEl.removeAttribute('src');
    videoEl.load();
    titleEl.textContent = '강의를 선택하세요';
    qaBtn.disabled = true;
    qaBtn.onclick = null;

    // Online-specific: add stream button
    if(mode==='online'){
      const addBtn = $('#btn-add-stream');
      if(addBtn){
        addBtn.onclick = ()=>{
          const url = window.prompt('HLS(.m3u8) 또는 MP4 강의 URL을 입력하세요');
          if(!url) return;
          const title = window.prompt('강의 제목을 입력하세요', '사용자 스트림') || '사용자 스트림';
          const newItem = { id: 'live-custom-'+Date.now(), title, src: url, live: true };
          onlineVideos.unshift(newItem);
          renderMode('online');
          // Auto-select the newly added stream
          selectVideo('online', newItem);
        };
      }

      // WebRTC controls (PeerJS 기반)
      const btnBroadcast = $('#btn-wrtc-broadcast');
      const btnWatch = $('#btn-wrtc-watch');
      const roomInput = $('#room-code');
      const statusEl = $('#wrtc-status');

      const setStatus = (t)=>{ if(statusEl) statusEl.textContent = t || ''; };

      if(btnBroadcast){
        btnBroadcast.onclick = async ()=>{
          roomCode = (roomInput && roomInput.value.trim()) || '';
          if(!roomCode) { alert('룸 코드를 입력하세요.'); return; }
          try{
            await startBroadcastWithPeerJS(roomCode, setStatus);
          }catch(e){
            console.error(e);
            alert('방송 시작 실패: '+ e.message);
          }
        };
      }
      if(btnWatch){
        btnWatch.onclick = async ()=>{
          roomCode = (roomInput && roomInput.value.trim()) || '';
          if(!roomCode) { alert('룸 코드를 입력하세요.'); return; }
          try{
            await startViewerWithPeerJS(roomCode, setStatus);
          }catch(e){
            console.error(e);
            alert('시청 시작 실패: '+ e.message);
          }
        };
      }
    }
  }

  function selectVideo(mode, item){
    currentVideo = item;
    // Mark active
    $$("#"+mode+"-list .item").forEach(el=>el.classList.remove('active'));
    const clicked = $$("#"+mode+"-list .item").find(el=>el.querySelector('.title').textContent===item.title);
    if(clicked) clicked.classList.add('active');

    const videoEl = $(`#${mode}-video`);
    const titleEl = $(`#${mode}-title`);
    const qaBtn = $(`#${mode}-qa`);
    playSource(videoEl, item.src);
    titleEl.textContent = item.title;
    qaBtn.disabled = false;
    qaBtn.onclick = ()=> openQAModal(item);
  }

  // Q&A modal logic
  const modal = $('#qa-modal');
  const qaThread = $('#qa-thread');
  const qaForm = $('#qa-form');
  const qaInput = $('#qa-input');
  const qaAuthor = $('#qa-author');

  function openQAModal(item){
    $('#qa-title').textContent = `질의응답 - ${item.title}`;
    renderThread(item.id);
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
    qaInput.focus();
  }

  function closeQAModal(){
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden','true');
  }

  function renderThread(videoId){
    const list = threads[videoId] || [];
    if(list.length === 0){
      qaThread.innerHTML = '<p class="qa-msg"><span class="time">아직 내용이 없습니다. 첫 메시지를 남겨보세요!</span></p>';
      return;
    }
    qaThread.innerHTML = list.map(m=>{
      const time = new Date(m.ts).toLocaleString();
      const who = m.author && m.author.trim() ? m.author.trim() : '익명';
      return `<div class="qa-msg"><div class="who">${who}</div><div class="text">${escapeHTML(m.text)}</div><div class="time">${time}</div></div>`;
    }).join('');
    qaThread.scrollTop = qaThread.scrollHeight;
  }

  function escapeHTML(str){
    return str.replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[s]));
  }

  // Close modal
  modal.addEventListener('click', (e)=>{
    if(e.target.matches('[data-close="qa"], .modal-backdrop')) closeQAModal();
  });
  document.addEventListener('keydown', (e)=>{
    if(e.key==='Escape' && modal.classList.contains('show')) closeQAModal();
  });

  // Submit message
  qaForm.addEventListener('submit', (e)=>{
    e.preventDefault();
    if(!currentVideo) return;
    const text = qaInput.value.trim();
    if(!text) return;
    const author = qaAuthor.value.trim();
    if(!threads[currentVideo.id]) threads[currentVideo.id] = [];
    threads[currentVideo.id].push({ author, text, ts: Date.now() });
    qaInput.value='';
    renderThread(currentVideo.id);
  });

  // Initialize
  function init(){
    initLanding();
  }
  document.addEventListener('DOMContentLoaded', init);
  // ========== PeerJS 기반 WebRTC Helpers ==========
  function cleanupPeerJS(){
    if(currentCall){
      try{ currentCall.close(); }catch(e){}
      currentCall = null;
    }
    if(peer){
      try{ peer.destroy(); }catch(e){}
      peer = null;
    }
    if(localStream){
      try{ localStream.getTracks().forEach(t => t.stop()); }catch(e){}
      localStream = null;
    }
    const videoEl = $('#online-video');
    if(videoEl && videoEl.srcObject){
      videoEl.srcObject = null;
    }
  }

  async function startBroadcastWithPeerJS(room, setStatus){
    cleanupPeerJS();

    // 1) 화면 공유 스트림 획득 (getDisplayMedia)
    //    브라우저에서 공유할 화면/창/탭을 선택하게 됨
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    const videoEl = $('#online-video');
    if(videoEl){
      videoEl.srcObject = localStream;
      // 화면 공유 중에는 에코를 막기 위해 기본적으로 음소거 유지
      videoEl.muted = true;
      videoEl.play().catch(()=>{});
    }

    // 2) PeerJS 인스턴스 생성 (room을 peer ID로 사용)
    if(typeof Peer === 'undefined'){
      throw new Error('PeerJS 라이브러리가 로드되지 않았습니다.');
    }

    peer = new Peer(room, {
      // PeerServer 설정에 맞춘 호스트/포트/경로
      host: '10.82.15.122',
      port: 9000,
      path: '/myapp',
    });

    peer.on('open', id => {
      if(setStatus) setStatus(`방송 중: ${id}`);
    });

    // 시청자가 이 방송자로 전화를 걸어올 때
    peer.on('call', call => {
      currentCall = call;
      call.answer(localStream);
      call.on('stream', remoteStream => {
        const v = $('#online-video');
        if(v){
          v.srcObject = remoteStream;
          v.muted = false;
          v.play().catch(()=>{});
        }
        if(setStatus) setStatus(`시청자와 연결됨 (${room})`);
      });
      call.on('close', () => {
        if(setStatus) setStatus(`방송 중: ${room} (시청자 연결 종료)`);
      });
      call.on('error', () => {
        if(setStatus) setStatus('오류: 통화 중 문제 발생');
      });
    });

    peer.on('error', err => {
      console.error(err);
      if(setStatus) setStatus('오류: ' + (err && err.type || 'Peer 오류'));
    });
  }

  async function startViewerWithPeerJS(room, setStatus){
    cleanupPeerJS();

    if(typeof Peer === 'undefined'){
      throw new Error('PeerJS 라이브러리가 로드되지 않았습니다.');
    }

    // 익명 시청자 peer 생성
    peer = new Peer(undefined, {
      host: location.hostname,
      port: 9000,
      path: '/myapp',
    });

    const videoEl = $('#online-video');

    peer.on('open', id => {
      if(setStatus) setStatus(`시청 준비 완료 (${id})`);

      // 방송자(room)를 대상으로 통화 요청
      const call = peer.call(room, null);
      currentCall = call;

      call.on('stream', remoteStream => {
        if(videoEl){
          videoEl.srcObject = remoteStream;
          videoEl.muted = false;
          videoEl.play().catch(()=>{});
        }
        if(setStatus) setStatus(`시청 중: ${room}`);
      });

      call.on('close', () => {
        if(setStatus) setStatus(`방송 종료 또는 연결 해제 (${room})`);
      });

      call.on('error', (err) => {
        console.error(err);
        if(setStatus) setStatus('오류: 통화 중 문제 발생');
      });
    });

    peer.on('error', err => {
      console.error(err);
      if(setStatus) setStatus('오류: ' + (err && err.type || 'Peer 오류'));
    });
  }

})();
