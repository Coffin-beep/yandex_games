/**
 * «Неоновый Рикошет» — HTML5-аркада для платформы Яндекс Игры
 * Чистый JavaScript + HTML5 Canvas + интеграция Yandex Games SDK v2
 */
(function () {
    'use strict';

    // =========================================================================
    // Безопасное хранилище (защита от SecurityError в режиме Инкогнито)
    // =========================================================================
    const SafeStorage = {
        memory: {},
        getInt(key, fallback = 0) {
            try {
                const raw = window.localStorage.getItem(key);
                if (raw === null) return this.memory[key] ?? fallback;
                const parsed = parseInt(raw, 10);
                return Number.isFinite(parsed) ? parsed : fallback;
            } catch (e) {
                return this.memory[key] ?? fallback;
            }
        },
        setInt(key, value) {
            this.memory[key] = value;
            try {
                window.localStorage.setItem(key, String(value));
            } catch (e) {
                // Игнорируем блокировку cookies/storage в приватном режиме
            }
        }
    };

    // =========================================================================
    // Процедурный синтезатор звуков и Synthwave-музыки (Web Audio API)
    // =========================================================================
    function midiToFreq(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    const MUSIC_BARS = [
        { bass: [45, 57], pad: [57, 60, 64, 67], arp: [69, 72, 76, 81], lead: [76, null, null, 72, null, null, 69, null, 72, null, 76, null, 79, null, 76, null] },
        { bass: [41, 53], pad: [53, 57, 60, 64], arp: [65, 69, 72, 76], lead: [77, null, null, 76, null, null, 72, null, 69, null, 72, null, 76, null, null, null] },
        { bass: [48, 60], pad: [55, 60, 64, 67], arp: [67, 72, 76, 79], lead: [79, null, null, 76, null, null, 72, null, 74, null, 76, null, 72, null, null, null] },
        { bass: [43, 55], pad: [55, 59, 62, 67], arp: [67, 71, 74, 79], lead: [74, null, null, 71, null, null, 67, null, 71, null, 74, null, 76, null, 74, null] },
        { bass: [50, 62], pad: [53, 57, 60, 62], arp: [69, 72, 74, 77], lead: [81, null, null, 77, null, null, 74, null, 76, null, 77, null, 81, null, 79, null] },
        { bass: [45, 57], pad: [57, 60, 64, 69], arp: [69, 72, 76, 81], lead: [76, null, null, 72, null, null, 69, null, 72, null, 76, null, 81, null, null, null] },
        { bass: [41, 53], pad: [53, 57, 60, 64], arp: [65, 69, 72, 76], lead: [77, null, 76, null, 74, null, 72, null, 74, null, 76, null, 77, null, 81, null] },
        { bass: [40, 52], pad: [52, 56, 59, 62], arp: [64, 68, 71, 76], lead: [76, null, null, null, 74, null, 72, null, 71, null, null, null, 68, null, 71, null] }
    ];

    const BASS_GROOVE = [1, 0, 2, 1, 0, 2, 1, 0, 1, 0, 2, 1, 0, 2, 1, 2];
    const ARP_ORDER = [0, 1, 2, 3, 2, 1, 0, 2, 1, 2, 3, 2, 1, 0, 2, 3];

    const SoundFX = {
        ctx: null,
        masterGain: null,
        sfxBus: null,
        musicBus: null,
        musicFilter: null,
        echoSend: null,
        noiseBuffer: null,

        userMuted: SafeStorage.getInt('neon_ricochet_muted', 0) === 1,
        musicMuted: SafeStorage.getInt('neon_ricochet_music_muted', 0) === 1,
        adMuted: false,
        visibilityMuted: false,

        musicStarted: false,
        musicMode: 'mellow', // 'playing' | 'mellow'
        schedulerId: null,
        nextNoteTime: 0,
        stepIndex: 0,
        stepDuration: 60 / 122 / 4, // 122 BPM, 16-е ноты

        isEffectiveMuted() {
            return this.userMuted || this.adMuted || this.visibilityMuted;
        },

        isMusicAudible() {
            return !this.isEffectiveMuted() && !this.musicMuted;
        },

        ensureAudioGraph() {
            if (this.ctx) return;
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;

            this.ctx = new AudioCtx();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.isEffectiveMuted() ? 0 : 1;
            this.masterGain.connect(this.ctx.destination);

            // Шина звуковых эффектов
            this.sfxBus = this.ctx.createGain();
            this.sfxBus.gain.value = 0.9;
            this.sfxBus.connect(this.masterGain);

            // Шина фоновой музыки с адаптивным фильтром и пространственным дилеем
            this.musicFilter = this.ctx.createBiquadFilter();
            this.musicFilter.type = 'lowpass';
            this.musicFilter.frequency.value = this.musicMode === 'playing' ? 14000 : 1050;
            this.musicFilter.Q.value = 0.7;
            this.musicFilter.connect(this.masterGain);

            this.musicBus = this.ctx.createGain();
            this.musicBus.gain.value = this.musicMuted ? 0 : (this.musicMode === 'playing' ? 0.34 : 0.18);
            this.musicBus.connect(this.musicFilter);

            // Пространственное эхо для лид-синтезатора и арпеджио
            const delay = this.ctx.createDelay(1.0);
            delay.delayTime.value = this.stepDuration * 3; // пунктирная восьмая
            const feedback = this.ctx.createGain();
            feedback.gain.value = 0.26;
            const echoFilter = this.ctx.createBiquadFilter();
            echoFilter.type = 'lowpass';
            echoFilter.frequency.value = 1900;

            this.echoSend = this.ctx.createGain();
            this.echoSend.gain.value = 0.24;
            this.echoSend.connect(delay);
            delay.connect(echoFilter);
            echoFilter.connect(feedback);
            feedback.connect(delay);
            echoFilter.connect(this.musicBus);

            // Короткий буфер белого шума для электронных ударных
            const sampleRate = this.ctx.sampleRate || 44100;
            const length = Math.floor(sampleRate * 0.22);
            this.noiseBuffer = this.ctx.createBuffer(1, length, sampleRate);
            const data = this.noiseBuffer.getChannelData(0);
            for (let i = 0; i < length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        },

        unlock() {
            try {
                this.ensureAudioGraph();
                if (!this.ctx) return;
                if (!this.isEffectiveMuted() && this.ctx.state === 'suspended') {
                    this.ctx.resume().catch(() => {});
                }
                this.startMusicLoop();
                this.syncLevels();
            } catch (e) {
                // Аудио недоступно
            }
        },

        syncLevels() {
            if (!this.ctx || !this.masterGain || !this.musicBus || !this.musicFilter) return;
            try {
                const now = this.ctx.currentTime;
                const muted = this.isEffectiveMuted();

                this.masterGain.gain.setTargetAtTime(muted ? 0 : 1, now, 0.025);

                const targetMusicVol = this.musicMuted ? 0 : (this.musicMode === 'playing' ? 0.34 : 0.17);
                this.musicBus.gain.setTargetAtTime(targetMusicVol, now, 0.08);

                const targetCutoff = this.musicMode === 'playing' ? 14000 : 1050;
                this.musicFilter.frequency.setTargetAtTime(targetCutoff, now, 0.12);

                if (muted) {
                    if (this.ctx.state === 'running') {
                        this.ctx.suspend().catch(() => {});
                    }
                } else if (this.ctx.state === 'suspended') {
                    this.ctx.resume().then(() => {
                        if (this.ctx) {
                            this.nextNoteTime = Math.max(this.nextNoteTime, this.ctx.currentTime + 0.05);
                        }
                    }).catch(() => {});
                }
            } catch (e) {}
        },

        setMusicMode(mode) {
            this.musicMode = mode === 'playing' ? 'playing' : 'mellow';
            this.syncLevels();
        },

        toggleUserMute() {
            this.userMuted = !this.userMuted;
            SafeStorage.setInt('neon_ricochet_muted', this.userMuted ? 1 : 0);
            if (!this.userMuted) this.unlock();
            else this.syncLevels();
            return this.userMuted;
        },

        toggleMusicMute() {
            this.musicMuted = !this.musicMuted;
            SafeStorage.setInt('neon_ricochet_music_muted', this.musicMuted ? 1 : 0);
            if (!this.musicMuted && !this.userMuted) {
                this.unlock();
            } else {
                this.syncLevels();
            }
            return this.musicMuted;
        },

        setAdMuted(flag) {
            this.adMuted = Boolean(flag);
            this.syncLevels();
        },

        setVisibilityMuted(flag) {
            this.visibilityMuted = Boolean(flag);
            this.syncLevels();
        },

        // =====================================================================
        // Секвенсор фоновой Synthwave-музыки
        // =====================================================================
        startMusicLoop() {
            if (this.musicStarted || !this.ctx) return;
            this.musicStarted = true;
            this.nextNoteTime = this.ctx.currentTime + 0.06;
            this.stepIndex = 0;

            this.schedulerId = setInterval(() => {
                this.scheduleMusicSteps();
            }, 75);
        },

        scheduleMusicSteps() {
            if (!this.ctx || this.ctx.state !== 'running' || !this.isMusicAudible()) return;

            const now = this.ctx.currentTime;
            // Защита от накопления очереди нот после паузы вкладки
            if (this.nextNoteTime < now - 0.1) {
                this.nextNoteTime = now + 0.04;
            }

            const lookahead = 0.19;
            while (this.nextNoteTime < now + lookahead) {
                this.triggerStep(this.stepIndex, this.nextNoteTime);
                this.nextNoteTime += this.stepDuration;
                this.stepIndex = (this.stepIndex + 1) % (MUSIC_BARS.length * 16);
            }
        },

        triggerStep(totalStep, time) {
            const barIdx = Math.floor(totalStep / 16) % MUSIC_BARS.length;
            const step = totalStep % 16;
            const bar = MUSIC_BARS[barIdx];
            const isFullPlay = this.musicMode === 'playing';

            // 1. Тёплый космический пэд в начале каждого такта
            if (step === 0) {
                this.playPadChord(bar.pad, time, this.stepDuration * 15.6);
            }

            // 2. Пульсирующий Synthwave-бас
            const bassSlot = BASS_GROOVE[step];
            if (bassSlot > 0) {
                const midi = bassSlot === 1 ? bar.bass[0] : bar.bass[1];
                this.playBassNote(midiToFreq(midi), time, this.stepDuration * 0.88);
            }

            // 3. Мерцающее неоновое арпеджио
            if (isFullPlay || step % 2 === 0) {
                const arpMidi = bar.arp[ARP_ORDER[step]];
                this.playArpPluck(midiToFreq(arpMidi), time, this.stepDuration * 0.82);
            }

            // 4. Солирующая мелодия и электронные ударные (в активной игре)
            if (isFullPlay) {
                const leadMidi = bar.lead[step];
                if (leadMidi !== null) {
                    // Вычисляем длительность ноты по следующим паузам
                    let holdSteps = 1;
                    while (step + holdSteps < 16 && bar.lead[step + holdSteps] === null && holdSteps < 4) {
                        holdSteps++;
                    }
                    this.playLeadNote(midiToFreq(leadMidi), time, this.stepDuration * holdSteps * 0.92);
                }

                // Бочка (4/4), малый барабан (2 и 4 доли) и мягкий хай-хэт
                if (step % 4 === 0) {
                    this.playKick(time);
                }
                if (step % 8 === 4) {
                    this.playSnare(time);
                }
                if (step % 2 === 1) {
                    this.playHat(time, 0.045);
                } else if (step % 4 === 2) {
                    this.playHat(time, 0.026);
                }
            }
        },

        playPadChord(midiNotes, time, duration) {
            try {
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(920, time);

                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.001, time);
                gain.gain.linearRampToValueAtTime(0.09, time + 0.22);
                gain.gain.setValueAtTime(0.08, time + Math.max(0.25, duration - 0.25));
                gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

                filter.connect(gain);
                gain.connect(this.musicBus);

                for (let i = 0; i < midiNotes.length; i++) {
                    const osc = this.ctx.createOscillator();
                    osc.type = i % 2 === 0 ? 'triangle' : 'sawtooth';
                    osc.frequency.setValueAtTime(midiToFreq(midiNotes[i]), time);
                    osc.detune.setValueAtTime((i - 1.5) * 6, time);
                    osc.connect(filter);
                    osc.start(time);
                    osc.stop(time + duration + 0.02);
                }
            } catch (e) {}
        },

        playBassNote(freq, time, duration) {
            try {
                const osc = this.ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(freq, time);

                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.Q.value = 2.4;
                filter.frequency.setValueAtTime(620, time);
                filter.frequency.exponentialRampToValueAtTime(170, time + duration);

                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.22, time);
                gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(this.musicBus);

                osc.start(time);
                osc.stop(time + duration + 0.01);
            } catch (e) {}
        },

        playArpPluck(freq, time, duration) {
            try {
                const osc = this.ctx.createOscillator();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, time);

                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.001, time);
                gain.gain.linearRampToValueAtTime(0.085, time + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

                osc.connect(gain);
                gain.connect(this.musicBus);
                if (this.echoSend) gain.connect(this.echoSend);

                osc.start(time);
                osc.stop(time + duration + 0.01);
            } catch (e) {}
        },

        playLeadNote(freq, time, duration) {
            try {
                const osc1 = this.ctx.createOscillator();
                const osc2 = this.ctx.createOscillator();
                osc1.type = 'sawtooth';
                osc2.type = 'triangle';
                osc1.frequency.setValueAtTime(freq, time);
                osc2.frequency.setValueAtTime(freq, time);
                osc1.detune.setValueAtTime(-7, time);
                osc2.detune.setValueAtTime(7, time);

                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(2400, time);
                filter.frequency.exponentialRampToValueAtTime(950, time + duration);

                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.001, time);
                gain.gain.linearRampToValueAtTime(0.11, time + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

                osc1.connect(filter);
                osc2.connect(filter);
                filter.connect(gain);
                gain.connect(this.musicBus);
                if (this.echoSend) gain.connect(this.echoSend);

                osc1.start(time);
                osc2.start(time);
                osc1.stop(time + duration + 0.02);
                osc2.stop(time + duration + 0.02);
            } catch (e) {}
        },

        playKick(time) {
            try {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(135, time);
                osc.frequency.exponentialRampToValueAtTime(42, time + 0.13);

                gain.gain.setValueAtTime(0.28, time);
                gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

                osc.connect(gain);
                gain.connect(this.musicBus);
                osc.start(time);
                osc.stop(time + 0.16);
            } catch (e) {}
        },

        playSnare(time) {
            if (!this.noiseBuffer) return;
            try {
                const noise = this.ctx.createBufferSource();
                noise.buffer = this.noiseBuffer;

                const filter = this.ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1850, time);
                filter.Q.value = 0.9;

                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.14, time);
                gain.gain.exponentialRampToValueAtTime(0.001, time + 0.11);

                noise.connect(filter);
                filter.connect(gain);
                gain.connect(this.musicBus);
                noise.start(time);
                noise.stop(time + 0.12);
            } catch (e) {}
        },

        playHat(time, volume) {
            if (!this.noiseBuffer) return;
            try {
                const noise = this.ctx.createBufferSource();
                noise.buffer = this.noiseBuffer;

                const filter = this.ctx.createBiquadFilter();
                filter.type = 'highpass';
                filter.frequency.setValueAtTime(6800, time);

                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(volume, time);
                gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

                noise.connect(filter);
                filter.connect(gain);
                gain.connect(this.musicBus);
                noise.start(time);
                noise.stop(time + 0.045);
            } catch (e) {}
        },

        // =====================================================================
        // Звуковые эффекты геймплея (SFX)
        // =====================================================================
        tone(freq, duration = 0.09, type = 'sine', volume = 0.14, slideTo = null) {
            if (this.isEffectiveMuted()) return;
            this.unlock();
            if (!this.ctx || this.ctx.state !== 'running' || !this.sfxBus) return;

            try {
                const now = this.ctx.currentTime;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = type;
                osc.frequency.setValueAtTime(freq, now);
                if (slideTo !== null) {
                    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
                }
                gain.gain.setValueAtTime(volume, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
                osc.connect(gain);
                gain.connect(this.sfxBus);
                osc.start(now);
                osc.stop(now + duration);
            } catch (e) {}
        },

        paddle() {
            this.tone(310, 0.08, 'triangle', 0.16, 460);
        },

        wall() {
            this.tone(220, 0.05, 'sine', 0.09, 180);
        },

        brickHit() {
            this.tone(420, 0.06, 'square', 0.08, 350);
        },

        brickBreak(combo = 1) {
            const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5];
            const f = scale[Math.min(combo - 1, scale.length - 1)];
            this.tone(f, 0.11, 'triangle', 0.15, f * 1.18);
        },

        explode() {
            this.tone(150, 0.24, 'sawtooth', 0.18, 42);
        },

        powerup() {
            this.tone(520, 0.08, 'triangle', 0.13, 780);
            setTimeout(() => this.tone(780, 0.12, 'triangle', 0.13, 1040), 65);
        },

        loseLife() {
            this.tone(300, 0.28, 'sawtooth', 0.15, 95);
        },

        levelWin() {
            const notes = [523.25, 659.25, 783.99, 1046.5];
            notes.forEach((n, idx) => {
                setTimeout(() => this.tone(n, 0.16, 'triangle', 0.15, n * 1.04), idx * 85);
            });
        },

        gameOver() {
            const notes = [392.0, 349.23, 311.13, 261.63];
            notes.forEach((n, idx) => {
                setTimeout(() => this.tone(n, 0.2, 'sawtooth', 0.12, n * 0.92), idx * 110);
            });
        }
    };

    // =========================================================================
    // Интеграция с Yandex Games SDK (GameplayAPI + Межстраничная реклама)
    // =========================================================================
    function notifyGameplayStart() {
        try {
            if (window.ysdk && window.ysdk.features && window.ysdk.features.GameplayAPI) {
                window.ysdk.features.GameplayAPI.start();
            }
        } catch (e) {}
    }

    function notifyGameplayStop() {
        try {
            if (window.ysdk && window.ysdk.features && window.ysdk.features.GameplayAPI) {
                window.ysdk.features.GameplayAPI.stop();
            }
        } catch (e) {}
    }

    /**
     * Показ межстраничной рекламы (Interstitial Ad) при проигрыше или смене уровня
     */
    function showInterstitialAd() {
        if (window.ysdk) {
            window.ysdk.adv.showFullscreenAdv({
                callbacks: {
                    onOpen: () => {
                        SoundFX.setAdMuted(true);
                    },
                    onClose: () => {
                        SoundFX.setAdMuted(false);
                    },
                    onError: () => {
                        SoundFX.setAdMuted(false);
                    }
                }
            });
        }
    }

    // =========================================================================
    // Облачные сохранения Yandex Games SDK (Player API: getData / setData)
    // =========================================================================
    const CloudSave = {
        player: null,
        ready: false,
        lastFlushTime: 0,
        pendingTimer: null,

        async init(ysdk) {
            if (!ysdk || typeof ysdk.getPlayer !== 'function') return;
            try {
                // scopes: false — не запрашиваем имя/аватар при старте (требование модерации)
                const player = await ysdk.getPlayer({ scopes: false });
                this.player = player;
                window.player = player;

                const cloudData = (await player.getData()) || {};
                const cloudBest = Number.isFinite(Number(cloudData.bestScore)) ? Math.max(0, Math.floor(Number(cloudData.bestScore))) : 0;
                const cloudMaxLevel = Number.isFinite(Number(cloudData.maxLevel)) ? Math.max(1, Math.floor(Number(cloudData.maxLevel))) : 1;

                const localWasAhead = state.bestScore > cloudBest || state.maxLevel > cloudMaxLevel;

                state.bestScore = Math.max(state.bestScore, cloudBest);
                state.maxLevel = Math.max(state.maxLevel, cloudMaxLevel);

                if (typeof cloudData.userMuted === 'boolean') {
                    SoundFX.userMuted = cloudData.userMuted;
                    SafeStorage.setInt('neon_ricochet_muted', SoundFX.userMuted ? 1 : 0);
                }
                if (typeof cloudData.musicMuted === 'boolean') {
                    SoundFX.musicMuted = cloudData.musicMuted;
                    SafeStorage.setInt('neon_ricochet_music_muted', SoundFX.musicMuted ? 1 : 0);
                }

                SafeStorage.setInt('neon_ricochet_best', state.bestScore);
                SafeStorage.setInt('neon_ricochet_max_level', state.maxLevel);
                SoundFX.syncLevels();

                this.ready = true;
                syncUIWithSavedProgress();

                // Если локальный прогресс опережал облачный (например, вход после игры без авторизации)
                if (localWasAhead) {
                    this.save(true);
                }
            } catch (err) {
                console.warn('Облачные сохранения недоступны, используется локальное хранилище:', err);
            }
        },

        buildPayload() {
            return {
                bestScore: state.bestScore,
                maxLevel: state.maxLevel,
                userMuted: SoundFX.userMuted,
                musicMuted: SoundFX.musicMuted
            };
        },

        save(immediate = true) {
            SafeStorage.setInt('neon_ricochet_best', state.bestScore);
            SafeStorage.setInt('neon_ricochet_max_level', state.maxLevel);
            SafeStorage.setInt('neon_ricochet_muted', SoundFX.userMuted ? 1 : 0);
            SafeStorage.setInt('neon_ricochet_music_muted', SoundFX.musicMuted ? 1 : 0);

            if (!this.player || typeof this.player.setData !== 'function') return;

            const payload = this.buildPayload();
            const now = Date.now();
            const cooldownMs = 1100;
            const elapsed = now - this.lastFlushTime;

            if (immediate && elapsed >= cooldownMs) {
                if (this.pendingTimer) {
                    clearTimeout(this.pendingTimer);
                    this.pendingTimer = null;
                }
                this.lastFlushTime = now;
                this.player.setData(payload, true).catch((err) => {
                    console.warn('Ошибка отправки облачного сохранения:', err);
                });
            } else {
                // Обновляем локальный кэш SDK сразу и планируем отложенную отправку на сервер
                this.player.setData(payload, false).catch(() => {});
                if (!this.pendingTimer) {
                    const waitMs = Math.max(250, cooldownMs - elapsed);
                    this.pendingTimer = setTimeout(() => {
                        this.pendingTimer = null;
                        this.lastFlushTime = Date.now();
                        if (this.player && typeof this.player.setData === 'function') {
                            this.player.setData(this.buildPayload(), true).catch(() => {});
                        }
                    }, waitMs);
                }
            }
        }
    };

    // =========================================================================
    // Константы игрового поля и палитры
    // =========================================================================
    const ARENA_W = 720;
    const ARENA_H = 920;

    const BRICK_PALETTE = [
        { main: '#00f0ff', dark: '#007a99', glow: 'rgba(0, 240, 255, 0.55)' },
        { main: '#ff3df0', dark: '#991188', glow: 'rgba(255, 61, 240, 0.55)' },
        { main: '#39ff88', dark: '#0e8a42', glow: 'rgba(57, 255, 136, 0.55)' },
        { main: '#ffd447', dark: '#9e7600', glow: 'rgba(255, 212, 71, 0.55)' },
        { main: '#8c52ff', dark: '#461da3', glow: 'rgba(140, 82, 255, 0.55)' },
        { main: '#ff6b4a', dark: '#9c2810', glow: 'rgba(255, 107, 74, 0.55)' }
    ];

    const POWERUP_TYPES = [
        { id: 'multiball', label: '×3', name: 'МУЛЬТИ-ШАР!', color: '#00f0ff' },
        { id: 'wide', label: '↔', name: 'МЕГА-ПЛАТФОРМА!', color: '#39ff88' },
        { id: 'fireball', label: '🔥', name: 'ПЛАЗМЕННЫЙ ШАР!', color: '#ff7b29' },
        { id: 'shield', label: '🛡', name: 'ЭНЕРГОЩИТ!', color: '#5c9dff' },
        { id: 'life', label: '❤', name: '+1 ЖИЗНЬ!', color: '#ff4d88' }
    ];

    // Шаблоны уровней:
    // '.' — пусто, '1'..'6' — цветной блок (1 HP), 'A' — броня (2 HP),
    // 'B' — тяжёлая броня (3 HP), 'X' — взрывной плазма-блок, '#' — титановый отражатель
    const LEVEL_PATTERNS = [
        // Уровень 1: Приветственный каскад
        [
            '111111111',
            '2222X2222',
            '333333333',
            '44.4X4.44',
            '555555555'
        ],
        // Уровень 2: Неоновая пирамида
        [
            '....X....',
            '...111...',
            '..22A22..',
            '.33AWA33.'.replace('W', 'X'),
            '444AAA444',
            '555555555'
        ],
        // Уровень 3: Двойной реактор
        [
            '.111.111.',
            '22A2.2A22',
            '3AXA.AXA3',
            '22A2.2A22',
            '.444.444.',
            '55.666.55'
        ],
        // Уровень 4: Космический бастион
        [
            'A111X111A',
            '22B222B22',
            '33.3X3.33',
            '#.44A44.#',
            '555555555',
            '.66.A.66.'
        ],
        // Уровень 5: Сверхновая
        [
            'B1A1X1A1B',
            '2A22B22A2',
            '.33X3X33.',
            '#44AAA44#',
            '55B555B55',
            '666.X.666'
        ]
    ];

    // =========================================================================
    // Состояние игры и ссылки на DOM
    // =========================================================================
    let canvas, ctx;
    let viewW = 800;
    let viewH = 600;
    let dpr = 1;
    let arenaRect = { x: 0, y: 0, scale: 1 };

    const ui = {};

    const state = {
        mode: 'menu', // 'menu' | 'playing' | 'paused' | 'levelcomplete' | 'gameover'
        level: 1,
        maxLevel: Math.max(1, SafeStorage.getInt('neon_ricochet_max_level', 1)),
        score: 0,
        bestScore: SafeStorage.getInt('neon_ricochet_best', 0),
        lives: 3,
        combo: 0,
        shieldActive: false,
        wideTimer: 0,
        fireballTimer: 0,
        shakeTime: 0,
        shakeStrength: 0,
        paddle: {
            x: ARENA_W / 2,
            y: 850,
            baseW: 132,
            w: 132,
            h: 18,
            targetX: null,
            vx: 0
        },
        balls: [],
        bricks: [],
        powerups: [],
        particles: [],
        popups: [],
        stars: [],
        keys: { left: false, right: false }
    };

    // =========================================================================
    // Инициализация игры
    // =========================================================================
    function initGame() {
        canvas = document.getElementById('gameCanvas');
        ctx = canvas.getContext('2d');

        ui.hud = document.getElementById('hud');
        ui.hudLevel = document.getElementById('hud-level');
        ui.hudScore = document.getElementById('hud-score');
        ui.hudBest = document.getElementById('hud-best');
        ui.hudLives = document.getElementById('hud-lives');
        ui.btnMusic = document.getElementById('btn-music');
        ui.btnSound = document.getElementById('btn-sound');
        ui.btnPause = document.getElementById('btn-pause');

        ui.screenStart = document.getElementById('screen-start');
        ui.screenPause = document.getElementById('screen-pause');
        ui.screenLevel = document.getElementById('screen-level');
        ui.screenGameOver = document.getElementById('screen-gameover');

        ui.startBest = document.getElementById('start-best');
        ui.cloudStatus = document.getElementById('cloud-status');
        ui.btnStart = document.getElementById('btn-start');
        ui.btnContinue = document.getElementById('btn-continue');
        ui.continueLevel = document.getElementById('continue-level');
        ui.completedLevel = document.getElementById('completed-level');
        ui.levelScore = document.getElementById('level-score');
        ui.levelBonus = document.getElementById('level-bonus');
        ui.finalScore = document.getElementById('final-score');
        ui.finalBest = document.getElementById('final-best');
        ui.newRecordBadge = document.getElementById('new-record-badge');

        createStarfield();
        handleResize();
        bindEvents();
        syncUIWithSavedProgress();

        // Загружаем фоновое демо уровня для красивого стартового экрана
        buildLevel(state.maxLevel);
        resetBallOnPaddle();

        let lastTime = performance.now();
        function frame(now) {
            const dt = Math.min(0.033, Math.max(0.001, (now - lastTime) / 1000));
            lastTime = now;
            update(dt);
            render(now * 0.001);
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function syncUIWithSavedProgress() {
        if (!ui.hud) return;
        refreshAudioButtons();
        updateHUD();
        if (ui.startBest) {
            ui.startBest.textContent = String(state.bestScore);
        }
        if (ui.cloudStatus) {
            ui.cloudStatus.classList.toggle('hidden', !CloudSave.ready);
        }
        if (ui.btnContinue && ui.btnStart && ui.continueLevel) {
            if (state.maxLevel > 1) {
                ui.continueLevel.textContent = String(state.maxLevel);
                ui.btnContinue.classList.remove('hidden');
                ui.btnStart.textContent = 'НОВАЯ ИГРА С 1 УРОВНЯ';
                ui.btnStart.classList.remove('primary-btn');
                ui.btnStart.classList.add('secondary-btn');
            } else {
                ui.btnContinue.classList.add('hidden');
                ui.btnStart.textContent = 'ИГРАТЬ';
                ui.btnStart.classList.add('primary-btn');
                ui.btnStart.classList.remove('secondary-btn');
            }
        }
        if (state.mode === 'menu') {
            buildLevel(state.maxLevel);
            resetBallOnPaddle();
        }
    }

    // =========================================================================
    // Адаптивный размер экрана и расчёт арены
    // =========================================================================
    function handleResize() {
        viewW = window.innerWidth || 800;
        viewH = window.innerHeight || 600;
        dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.floor(viewW * dpr);
        canvas.height = Math.floor(viewH * dpr);

        const topReserved = state.mode === 'menu' ? 18 : 68;
        const bottomReserved = viewH > viewW ? 26 : 14;
        const sideMargin = 14;

        const availW = Math.max(200, viewW - sideMargin * 2);
        const availH = Math.max(240, viewH - topReserved - bottomReserved);

        const scale = Math.min(availW / ARENA_W, availH / ARENA_H);
        const drawW = ARENA_W * scale;
        const drawH = ARENA_H * scale;

        arenaRect.scale = scale;
        arenaRect.x = (viewW - drawW) * 0.5;
        arenaRect.y = topReserved + (availH - drawH) * 0.5;
    }

    function createStarfield() {
        state.stars = [];
        for (let i = 0; i < 85; i++) {
            state.stars.push({
                nx: Math.random(),
                ny: Math.random(),
                size: 0.7 + Math.random() * 1.9,
                speed: 0.015 + Math.random() * 0.045,
                phase: Math.random() * Math.PI * 2,
                hue: Math.random() < 0.3 ? '#7af5ff' : (Math.random() < 0.5 ? '#ffc4ff' : '#ffffff')
            });
        }
    }

    // =========================================================================
    // Обработчики событий (мышь, тач, клавиатура, видимость вкладки)
    // =========================================================================
    function bindEvents() {
        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', () => setTimeout(handleResize, 100));

        // Блокируем контекстное меню по требованию модерации Яндекс Игр
        window.addEventListener('contextmenu', (e) => e.preventDefault());

        // Автопауза и отключение звука при сворачивании вкладки / потере фокуса
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                SoundFX.setVisibilityMuted(true);
                if (state.mode === 'playing') {
                    pauseGame();
                }
            } else {
                SoundFX.setVisibilityMuted(false);
            }
        });

        window.addEventListener('blur', () => {
            SoundFX.setVisibilityMuted(true);
        });

        window.addEventListener('focus', () => {
            if (!document.hidden) {
                SoundFX.setVisibilityMuted(false);
            }
        });

        // Кнопки интерфейса
        ui.btnStart.addEventListener('click', () => {
            SoundFX.unlock();
            startNewRun(1);
        });

        if (ui.btnContinue) {
            ui.btnContinue.addEventListener('click', () => {
                SoundFX.unlock();
                startNewRun(state.maxLevel);
            });
        }

        ui.btnPause.addEventListener('click', () => {
            SoundFX.unlock();
            if (state.mode === 'playing') pauseGame();
            else if (state.mode === 'paused') resumeGame();
        });

        ui.btnMusic.addEventListener('click', () => {
            if (SoundFX.userMuted) {
                SoundFX.userMuted = false;
                SoundFX.musicMuted = false;
                SafeStorage.setInt('neon_ricochet_muted', 0);
                SafeStorage.setInt('neon_ricochet_music_muted', 0);
                SoundFX.unlock();
            } else {
                SoundFX.toggleMusicMute();
            }
            refreshAudioButtons();
            CloudSave.save(false);
        });

        ui.btnSound.addEventListener('click', () => {
            SoundFX.toggleUserMute();
            refreshAudioButtons();
            CloudSave.save(false);
        });

        document.getElementById('btn-resume').addEventListener('click', () => {
            SoundFX.unlock();
            resumeGame();
        });

        document.getElementById('btn-restart-pause').addEventListener('click', () => {
            SoundFX.unlock();
            startNewRun(1);
        });

        document.getElementById('btn-next-level').addEventListener('click', () => {
            SoundFX.unlock();
            advanceToNextLevel();
        });

        document.getElementById('btn-retry').addEventListener('click', () => {
            SoundFX.unlock();
            startNewRun(state.level);
        });

        // Управление указателем (мышь и тач через Pointer Events)
        let activePointerId = null;

        function screenToArenaX(clientX) {
            return (clientX - arenaRect.x) / arenaRect.scale;
        }

        canvas.addEventListener('pointerdown', (e) => {
            if (state.mode !== 'playing') return;
            e.preventDefault();
            SoundFX.unlock();
            activePointerId = e.pointerId;
            state.paddle.targetX = screenToArenaX(e.clientX);
        });

        window.addEventListener('pointermove', (e) => {
            if (state.mode !== 'playing') return;
            if (e.pointerType === 'mouse' || e.pointerId === activePointerId) {
                state.paddle.targetX = screenToArenaX(e.clientX);
            }
        });

        window.addEventListener('pointerup', (e) => {
            if (state.mode !== 'playing') return;
            if (e.pointerType === 'mouse' || e.pointerId === activePointerId) {
                activePointerId = null;
                launchAttachedBalls();
            }
        });

        window.addEventListener('pointercancel', () => {
            activePointerId = null;
        });

        // Клавиатура для ПК
        window.addEventListener('keydown', (e) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', ' '].includes(e.key)) {
                e.preventDefault();
            }

            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') {
                state.keys.left = true;
                state.paddle.targetX = null;
            }
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') {
                state.keys.right = true;
                state.paddle.targetX = null;
            }
            if (e.key === ' ' || e.code === 'Space' || e.key === 'ArrowUp') {
                if (state.mode === 'playing') {
                    SoundFX.unlock();
                    launchAttachedBalls();
                }
            }
            if (e.key === 'Escape' || e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') {
                if (state.mode === 'playing') pauseGame();
                else if (state.mode === 'paused') resumeGame();
            }
            if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') {
                SoundFX.toggleMusicMute();
                refreshAudioButtons();
                CloudSave.save(false);
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') {
                state.keys.left = false;
            }
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') {
                state.keys.right = false;
            }
        });
    }

    function refreshAudioButtons() {
        const masterOff = SoundFX.userMuted;
        const musicOff = masterOff || SoundFX.musicMuted;

        ui.btnSound.textContent = masterOff ? '🔇' : '🔊';
        ui.btnSound.classList.toggle('is-off', masterOff);

        if (ui.btnMusic) {
            ui.btnMusic.classList.toggle('is-off', musicOff);
        }
    }

    // =========================================================================
    // Управление состояниями игры и уровнями
    // =========================================================================
    function hideAllOverlays() {
        ui.screenStart.classList.add('hidden');
        ui.screenPause.classList.add('hidden');
        ui.screenLevel.classList.add('hidden');
        ui.screenGameOver.classList.add('hidden');
    }

    function startNewRun(startLevel = 1) {
        state.level = Math.max(1, Math.floor(startLevel) || 1);
        state.score = 0;
        state.lives = 3;
        state.combo = 0;
        state.shieldActive = false;
        state.wideTimer = 0;
        state.fireballTimer = 0;
        state.powerups = [];
        state.particles = [];
        state.popups = [];

        buildLevel(state.level);
        resetBallOnPaddle();

        hideAllOverlays();
        ui.hud.classList.remove('hidden');
        state.mode = 'playing';
        SoundFX.setMusicMode('playing');
        handleResize();
        updateHUD();
        notifyGameplayStart();
    }

    function pauseGame() {
        if (state.mode !== 'playing') return;
        state.mode = 'paused';
        SoundFX.setMusicMode('mellow');
        ui.screenPause.classList.remove('hidden');
        notifyGameplayStop();
        CloudSave.save(true);
    }

    function resumeGame() {
        if (state.mode !== 'paused') return;
        hideAllOverlays();
        state.mode = 'playing';
        SoundFX.setMusicMode('playing');
        notifyGameplayStart();
    }

    function completeCurrentLevel() {
        state.mode = 'levelcomplete';
        SoundFX.setMusicMode('mellow');
        notifyGameplayStop();
        SoundFX.levelWin();

        const bonus = 300 + state.level * 200 + state.lives * 50;
        addScore(bonus);

        // Открываем следующий уровень и сохраняем прогресс в облако Яндекс Игр
        const nextUnlocked = state.level + 1;
        if (nextUnlocked > state.maxLevel) {
            state.maxLevel = nextUnlocked;
        }
        CloudSave.save(true);

        ui.completedLevel.textContent = String(state.level);
        ui.levelScore.textContent = String(state.score);
        ui.levelBonus.textContent = '+' + bonus;
        ui.screenLevel.classList.remove('hidden');
    }

    function advanceToNextLevel() {
        // Вызов межстраничной рекламы при переходе между уровнями
        showInterstitialAd();

        state.level += 1;
        if (state.level > state.maxLevel) {
            state.maxLevel = state.level;
        }
        state.combo = 0;
        state.wideTimer = 0;
        state.fireballTimer = 0;
        state.powerups = [];

        buildLevel(state.level);
        resetBallOnPaddle();

        hideAllOverlays();
        state.mode = 'playing';
        SoundFX.setMusicMode('playing');
        updateHUD();
        CloudSave.save(true);
        notifyGameplayStart();
    }

    function triggerGameOver() {
        state.mode = 'gameover';
        SoundFX.setMusicMode('mellow');
        notifyGameplayStop();
        SoundFX.gameOver();
        CloudSave.save(true);

        const isNewRecord = state.score > 0 && state.score >= state.bestScore;
        ui.finalScore.textContent = String(state.score);
        ui.finalBest.textContent = String(state.bestScore);
        ui.newRecordBadge.classList.toggle('hidden', !isNewRecord);
        ui.screenGameOver.classList.remove('hidden');

        // Вызов межстраничной рекламы при проигрыше
        showInterstitialAd();
    }

    function addScore(points) {
        state.score += points;
        if (state.score > state.bestScore) {
            state.bestScore = state.score;
            SafeStorage.setInt('neon_ricochet_best', state.bestScore);
        }
        updateHUD();
    }

    function updateHUD() {
        ui.hudLevel.textContent = String(state.level);
        ui.hudScore.textContent = String(state.score);
        ui.hudBest.textContent = String(state.bestScore);
        ui.hudLives.textContent = '❤️'.repeat(Math.max(0, state.lives)) || '—';
    }

    // =========================================================================
    // Генерация уровней и объектов
    // =========================================================================
    function buildLevel(levelNumber) {
        state.bricks = [];
        const cols = 9;
        const marginX = 34;
        const gap = 8;
        const brickW = (ARENA_W - marginX * 2 - gap * (cols - 1)) / cols;
        const brickH = 28;
        const startY = 82;

        let rows;
        if (levelNumber <= LEVEL_PATTERNS.length) {
            rows = LEVEL_PATTERNS[levelNumber - 1];
        } else {
            // Процедурные уровни для бесконечной игры после 5-го сектора
            rows = generateProceduralPattern(levelNumber, cols);
        }

        for (let r = 0; r < rows.length; r++) {
            const rowStr = rows[r];
            for (let c = 0; c < cols; c++) {
                const ch = rowStr[c] || '.';
                if (ch === '.') continue;

                const x = marginX + c * (brickW + gap);
                const y = startY + r * (brickH + gap);

                let type = 'normal';
                let hp = 1;
                let colorIndex = (r + c) % BRICK_PALETTE.length;

                if (ch >= '1' && ch <= '6') {
                    colorIndex = parseInt(ch, 10) - 1;
                } else if (ch === 'A') {
                    type = 'armor';
                    hp = 2;
                    colorIndex = (r + 2) % BRICK_PALETTE.length;
                } else if (ch === 'B') {
                    type = 'armor';
                    hp = 3;
                    colorIndex = 4;
                } else if (ch === 'X') {
                    type = 'explosive';
                    hp = 1;
                } else if (ch === '#') {
                    type = 'solid';
                    hp = 999;
                }

                state.bricks.push({
                    x,
                    y,
                    w: brickW,
                    h: brickH,
                    type,
                    hp,
                    maxHp: hp,
                    color: BRICK_PALETTE[colorIndex],
                    hitFlash: 0
                });
            }
        }
    }

    function generateProceduralPattern(levelNumber, cols) {
        const rowsCount = Math.min(8, 5 + Math.floor(levelNumber / 3));
        const rows = [];
        const half = Math.ceil(cols / 2);

        for (let r = 0; r < rowsCount; r++) {
            const left = [];
            for (let c = 0; c < half; c++) {
                const roll = Math.sin(levelNumber * 13.37 + r * 7.1 + c * 3.9) * 0.5 + 0.5;
                if (roll < 0.14) left.push('.');
                else if (roll < 0.24 && r > 0) left.push('X');
                else if (roll < 0.48) left.push('A');
                else if (roll < 0.58 && levelNumber >= 7) left.push('B');
                else left.push(String(((r + c + levelNumber) % 6) + 1));
            }
            const right = left.slice(0, Math.floor(cols / 2)).reverse();
            rows.push(left.concat(right).join(''));
        }
        return rows;
    }

    function getBaseBallSpeed() {
        return Math.min(760, 540 + (state.level - 1) * 26);
    }

    function resetBallOnPaddle() {
        state.paddle.w = state.wideTimer > 0 ? Math.round(state.paddle.baseW * 1.44) : state.paddle.baseW;
        state.paddle.x = ARENA_W * 0.5;
        state.paddle.targetX = null;
        state.combo = 0;

        state.balls = [{
            x: state.paddle.x,
            y: state.paddle.y - state.paddle.h * 0.5 - 10,
            vx: 0,
            vy: 0,
            r: 9,
            attached: true,
            trail: [],
            nonProductiveHits: 0
        }];
    }

    function launchAttachedBalls() {
        const speed = getBaseBallSpeed();
        let launched = false;
        for (const b of state.balls) {
            if (b.attached) {
                const slightAngle = (Math.random() - 0.5) * 0.36;
                b.vx = Math.sin(slightAngle) * speed;
                b.vy = -Math.cos(slightAngle) * speed;
                b.attached = false;
                launched = true;
            }
        }
        if (launched) {
            SoundFX.paddle();
        }
    }

    // =========================================================================
    // Игровой цикл обновления физики
    // =========================================================================
    function update(dt) {
        // Фоновые звёзды анимируются всегда
        for (const s of state.stars) {
            s.ny += s.speed * dt;
            if (s.ny > 1.02) {
                s.ny = -0.02;
                s.nx = Math.random();
            }
        }

        if (state.mode !== 'playing') return;

        // Таймеры бонусов и тряски экрана
        if (state.wideTimer > 0) {
            state.wideTimer = Math.max(0, state.wideTimer - dt);
        }
        if (state.fireballTimer > 0) {
            state.fireballTimer = Math.max(0, state.fireballTimer - dt);
        }
        if (state.shakeTime > 0) {
            state.shakeTime = Math.max(0, state.shakeTime - dt);
        }

        const desiredW = state.wideTimer > 0 ? state.paddle.baseW * 1.44 : state.paddle.baseW;
        state.paddle.w += (desiredW - state.paddle.w) * Math.min(1, dt * 12);

        // Движение платформы
        const prevPaddleX = state.paddle.x;
        const keySpeed = 690;

        if (state.keys.left) {
            state.paddle.x -= keySpeed * dt;
        }
        if (state.keys.right) {
            state.paddle.x += keySpeed * dt;
        }
        if (state.paddle.targetX !== null) {
            const diff = state.paddle.targetX - state.paddle.x;
            state.paddle.x += diff * Math.min(1, dt * 24);
        }

        const minX = 14 + state.paddle.w * 0.5;
        const maxX = ARENA_W - 14 - state.paddle.w * 0.5;
        state.paddle.x = Math.max(minX, Math.min(maxX, state.paddle.x));
        state.paddle.vx = (state.paddle.x - prevPaddleX) / dt;

        // Обновление вспышек блоков
        for (const br of state.bricks) {
            if (br.hitFlash > 0) {
                br.hitFlash = Math.max(0, br.hitFlash - dt * 5);
            }
        }

        // Обновление шаров с подшагами (защита от пролёта сквозь блоки)
        const targetSpeed = getBaseBallSpeed();
        for (let i = state.balls.length - 1; i >= 0; i--) {
            const b = state.balls[i];
            if (b.attached) {
                b.x = state.paddle.x;
                b.y = state.paddle.y - state.paddle.h * 0.5 - b.r - 1;
                b.trail.length = 0;
                continue;
            }

            b.trail.push({ x: b.x, y: b.y });
            if (b.trail.length > 10) b.trail.shift();

            const speedNow = Math.hypot(b.vx, b.vy) || targetSpeed;
            const steps = Math.max(2, Math.min(6, Math.ceil((speedNow * dt) / 5)));
            const subDt = dt / steps;

            let lost = false;
            for (let s = 0; s < steps; s++) {
                b.x += b.vx * subDt;
                b.y += b.vy * subDt;

                // Столкновение со стенами арены
                if (b.x - b.r < 10) {
                    b.x = 10 + b.r;
                    b.vx = Math.abs(b.vx);
                    SoundFX.wall();
                } else if (b.x + b.r > ARENA_W - 10) {
                    b.x = ARENA_W - 10 - b.r;
                    b.vx = -Math.abs(b.vx);
                    SoundFX.wall();
                }

                if (b.y - b.r < 10) {
                    b.y = 10 + b.r;
                    b.vy = Math.abs(b.vy);
                    SoundFX.wall();
                }

                // Нижний энергощит
                if (state.shieldActive && b.vy > 0 && b.y + b.r >= 890) {
                    b.y = 890 - b.r;
                    b.vy = -Math.abs(b.vy);
                    state.shieldActive = false;
                    SoundFX.powerup();
                    spawnParticles(b.x, 890, '#5c9dff', 20);
                    spawnPopup(b.x, 865, 'ЩИТ СПАС!', '#5c9dff');
                }

                // Проверка вылета за нижнюю границу
                if (b.y - b.r > ARENA_H + 20) {
                    lost = true;
                    break;
                }

                // Столкновение с платформой
                const pLeft = state.paddle.x - state.paddle.w * 0.5;
                const pRight = state.paddle.x + state.paddle.w * 0.5;
                const pTop = state.paddle.y - state.paddle.h * 0.5;
                const pBottom = state.paddle.y + state.paddle.h * 0.5;

                if (
                    b.vy > 0 &&
                    b.x + b.r >= pLeft &&
                    b.x - b.r <= pRight &&
                    b.y + b.r >= pTop &&
                    b.y - b.r <= pBottom
                ) {
                    const hitOffset = Math.max(-1, Math.min(1, (b.x - state.paddle.x) / (state.paddle.w * 0.5)));
                    const maxBounceAngle = 1.16; // ~66 градусов
                    const angle = hitOffset * maxBounceAngle;
                    const spd = getBaseBallSpeed();

                    b.vx = Math.sin(angle) * spd + state.paddle.vx * 0.08;
                    b.vy = -Math.cos(angle) * spd;
                    normalizeBallSpeed(b, spd);

                    b.y = pTop - b.r - 0.5;
                    b.nonProductiveHits = 0;
                    state.combo = 0;
                    SoundFX.paddle();
                    spawnParticles(b.x, pTop, '#00f0ff', 7);
                }

                // Столкновение с блоками
                checkBrickCollisions(b);
            }

            if (lost) {
                state.balls.splice(i, 1);
            }
        }

        // Если все шары потеряны
        if (state.balls.length === 0) {
            state.lives -= 1;
            state.combo = 0;
            state.wideTimer = 0;
            state.fireballTimer = 0;
            updateHUD();

            if (state.lives <= 0) {
                triggerGameOver();
                return;
            } else {
                SoundFX.loseLife();
                resetBallOnPaddle();
            }
        }

        // Движение и подбор капсул бонусов
        updatePowerups(dt);

        // Частицы и всплывающие надписи
        updateParticlesAndPopups(dt);

        // Проверка победы на уровне (считаем только разрушаемые блоки)
        const remainingBreakable = state.bricks.some((br) => br.type !== 'solid');
        if (!remainingBreakable) {
            completeCurrentLevel();
        }
    }

    function normalizeBallSpeed(ball, desiredSpeed) {
        let len = Math.hypot(ball.vx, ball.vy);
        if (len < 0.001) {
            ball.vx = 0;
            ball.vy = -desiredSpeed;
            return;
        }
        // Гарантируем минимальный вертикальный наклон, чтобы шар не застревал горизонтально
        const minVy = desiredSpeed * 0.24;
        if (Math.abs(ball.vy) < minVy) {
            ball.vy = (ball.vy >= 0 ? 1 : -1) * minVy;
            const remVx = Math.sqrt(Math.max(1, desiredSpeed * desiredSpeed - ball.vy * ball.vy));
            ball.vx = (ball.vx >= 0 ? 1 : -1) * remVx;
        } else {
            const factor = desiredSpeed / len;
            ball.vx *= factor;
            ball.vy *= factor;
        }
    }

    function checkBrickCollisions(ball) {
        const isFireball = state.fireballTimer > 0;

        for (let i = state.bricks.length - 1; i >= 0; i--) {
            const br = state.bricks[i];
            const closestX = Math.max(br.x, Math.min(ball.x, br.x + br.w));
            const closestY = Math.max(br.y, Math.min(ball.y, br.y + br.h));
            const dx = ball.x - closestX;
            const dy = ball.y - closestY;

            if (dx * dx + dy * dy > ball.r * ball.r) continue;

            // Огненный шар прошивает обычные блоки насквозь без отскока
            const pierceThrough = isFireball && br.type !== 'solid' && br.hp <= 1;

            if (!pierceThrough) {
                const overlapLeft = (ball.x + ball.r) - br.x;
                const overlapRight = (br.x + br.w) - (ball.x - ball.r);
                const overlapTop = (ball.y + ball.r) - br.y;
                const overlapBottom = (br.y + br.h) - (ball.y - ball.r);

                const minOverlapX = Math.min(overlapLeft, overlapRight);
                const minOverlapY = Math.min(overlapTop, overlapBottom);

                if (minOverlapX < minOverlapY) {
                    if (overlapLeft < overlapRight) {
                        ball.x = br.x - ball.r - 0.4;
                        ball.vx = -Math.abs(ball.vx);
                    } else {
                        ball.x = br.x + br.w + ball.r + 0.4;
                        ball.vx = Math.abs(ball.vx);
                    }
                } else {
                    if (overlapTop < overlapBottom) {
                        ball.y = br.y - ball.r - 0.4;
                        ball.vy = -Math.abs(ball.vy);
                    } else {
                        ball.y = br.y + br.h + ball.r + 0.4;
                        ball.vy = Math.abs(ball.vy);
                    }
                }
            }

            if (br.type === 'solid') {
                br.hitFlash = 1;
                ball.nonProductiveHits += 1;
                if (ball.nonProductiveHits > 16) {
                    ball.vy += 45;
                    ball.nonProductiveHits = 0;
                }
                normalizeBallSpeed(ball, getBaseBallSpeed());
                SoundFX.wall();
                spawnParticles(closestX, closestY, '#b5c7e8', 5);
                break;
            }

            ball.nonProductiveHits = 0;
            damageBrick(br, isFireball ? 2 : 1);
            normalizeBallSpeed(ball, getBaseBallSpeed());
            break;
        }
    }

    function damageBrick(br, amount) {
        const index = state.bricks.indexOf(br);
        if (index === -1 || br.type === 'solid') return;

        br.hp -= amount;
        br.hitFlash = 1;
        const cx = br.x + br.w * 0.5;
        const cy = br.y + br.h * 0.5;

        if (br.hp > 0) {
            SoundFX.brickHit();
            addScore(15);
            spawnParticles(cx, cy, br.color.main, 6);
            return;
        }

        // Разрушение блока
        state.bricks.splice(index, 1);
        state.combo = Math.min(8, state.combo + 1);
        const gained = 25 * state.combo;
        addScore(gained);

        const mainColor = br.type === 'explosive' ? '#ff6b2b' : br.color.main;
        spawnParticles(cx, cy, mainColor, 16);

        if (state.combo >= 3) {
            spawnPopup(cx, cy - 6, `КОМБО ×${state.combo}!`, '#ffd447');
        } else {
            spawnPopup(cx, cy - 4, `+${gained}`, '#ffffff');
        }

        if (br.type === 'explosive') {
            detonateAt(cx, cy);
        } else {
            SoundFX.brickBreak(state.combo);
            maybeDropPowerup(cx, cy);
        }
    }

    function detonateAt(cx, cy) {
        SoundFX.explode();
        state.shakeTime = 0.22;
        state.shakeStrength = 8;
        spawnParticles(cx, cy, '#ff8533', 30);
        spawnPopup(cx, cy - 14, 'ВЗРЫВ!', '#ff7b29');

        const blastRadius = 118;
        const targets = state.bricks.filter((other) => {
            if (other.type === 'solid') return false;
            const ox = other.x + other.w * 0.5;
            const oy = other.y + other.h * 0.5;
            return Math.hypot(ox - cx, oy - cy) <= blastRadius;
        });

        for (const target of targets) {
            damageBrick(target, 2);
        }
    }

    // =========================================================================
    // Бонусы (Power-ups)
    // =========================================================================
    function maybeDropPowerup(x, y) {
        if (state.powerups.length >= 3) return;
        if (Math.random() > 0.21) return;

        // Если жизней максимум — реже выдаём дополнительную жизнь
        let pool = POWERUP_TYPES;
        if (state.lives >= 5) {
            pool = POWERUP_TYPES.filter((p) => p.id !== 'life');
        }
        const chosen = pool[Math.floor(Math.random() * pool.length)];

        state.powerups.push({
            x,
            y,
            w: 48,
            h: 24,
            vy: 215,
            def: chosen
        });
    }

    function updatePowerups(dt) {
        const pLeft = state.paddle.x - state.paddle.w * 0.5;
        const pRight = state.paddle.x + state.paddle.w * 0.5;
        const pTop = state.paddle.y - state.paddle.h * 0.5;
        const pBottom = state.paddle.y + state.paddle.h * 0.5;

        for (let i = state.powerups.length - 1; i >= 0; i--) {
            const p = state.powerups[i];
            p.y += p.vy * dt;

            if (
                p.x + p.w * 0.5 >= pLeft &&
                p.x - p.w * 0.5 <= pRight &&
                p.y + p.h * 0.5 >= pTop &&
                p.y - p.h * 0.5 <= pBottom
            ) {
                applyPowerup(p.def, p.x, pTop);
                state.powerups.splice(i, 1);
                continue;
            }

            if (p.y - p.h > ARENA_H + 20) {
                state.powerups.splice(i, 1);
            }
        }
    }

    function applyPowerup(def, x, y) {
        SoundFX.powerup();
        addScore(75);
        spawnParticles(x, y, def.color, 18);
        spawnPopup(x, y - 16, def.name, def.color);

        switch (def.id) {
            case 'multiball': {
                if (state.balls.some((b) => b.attached)) {
                    launchAttachedBalls();
                }
                const source = state.balls[0];
                if (source && state.balls.length < 9) {
                    const spd = getBaseBallSpeed();
                    const baseAngle = Math.atan2(source.vy, source.vx);
                    [-0.38, 0.38].forEach((offset) => {
                        state.balls.push({
                            x: source.x,
                            y: source.y,
                            vx: Math.cos(baseAngle + offset) * spd,
                            vy: Math.sin(baseAngle + offset) * spd,
                            r: source.r,
                            attached: false,
                            trail: [],
                            nonProductiveHits: 0
                        });
                        normalizeBallSpeed(state.balls[state.balls.length - 1], spd);
                    });
                }
                break;
            }
            case 'wide':
                state.wideTimer = 13;
                break;
            case 'fireball':
                state.fireballTimer = 8.5;
                break;
            case 'shield':
                state.shieldActive = true;
                break;
            case 'life':
                state.lives = Math.min(5, state.lives + 1);
                updateHUD();
                break;
        }
    }

    // =========================================================================
    // Эффекты частиц и всплывающих подсказок
    // =========================================================================
    function spawnParticles(x, y, color, count) {
        if (state.particles.length > 180) return;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 70 + Math.random() * 250;
            state.particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 2.2 + Math.random() * 3.6,
                life: 0.35 + Math.random() * 0.35,
                maxLife: 0.7,
                color
            });
        }
    }

    function spawnPopup(x, y, text, color) {
        state.popups.push({
            x: Math.max(70, Math.min(ARENA_W - 70, x)),
            y,
            text,
            color,
            life: 0.85,
            maxLife: 0.85
        });
    }

    function updateParticlesAndPopups(dt) {
        for (let i = state.particles.length - 1; i >= 0; i--) {
            const pt = state.particles[i];
            pt.x += pt.vx * dt;
            pt.y += pt.vy * dt;
            pt.vy += 240 * dt;
            pt.life -= dt;
            if (pt.life <= 0) state.particles.splice(i, 1);
        }

        for (let i = state.popups.length - 1; i >= 0; i--) {
            const pp = state.popups[i];
            pp.y -= 48 * dt;
            pp.life -= dt;
            if (pp.life <= 0) state.popups.splice(i, 1);
        }
    }

    // =========================================================================
    // Отрисовка сцены на HTML5 Canvas
    // =========================================================================
    function render(timeSec) {
        ctx.save();
        ctx.scale(dpr, dpr);

        // Космический градиент на весь экран
        const bgGrad = ctx.createRadialGradient(
            viewW * 0.5, viewH * 0.35, 30,
            viewW * 0.5, viewH * 0.5, Math.max(viewW, viewH) * 0.85
        );
        bgGrad.addColorStop(0, '#10193f');
        bgGrad.addColorStop(0.55, '#080d24');
        bgGrad.addColorStop(1, '#040612');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, viewW, viewH);

        // Мерцающие звёзды
        for (const s of state.stars) {
            const alpha = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(timeSec * 2.4 + s.phase));
            ctx.globalAlpha = alpha;
            ctx.fillStyle = s.hue;
            ctx.beginPath();
            ctx.arc(s.nx * viewW, s.ny * viewH, s.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Переход в локальные координаты игровой арены
        ctx.save();
        let shakeX = 0;
        let shakeY = 0;
        if (state.shakeTime > 0) {
            const mag = state.shakeStrength * (state.shakeTime / 0.22);
            shakeX = (Math.random() - 0.5) * mag * 2;
            shakeY = (Math.random() - 0.5) * mag * 2;
        }

        ctx.translate(arenaRect.x + shakeX, arenaRect.y + shakeY);
        ctx.scale(arenaRect.scale, arenaRect.scale);

        drawArenaFrame(timeSec);
        drawBricks(timeSec);
        drawPowerups();
        drawShield(timeSec);
        drawPaddle(timeSec);
        drawBalls();
        drawParticlesAndPopups();
        drawActiveBuffBars();
        drawLaunchPrompt(timeSec);

        ctx.restore();
        ctx.restore();
    }

    function drawArenaFrame(timeSec) {
        // Полупрозрачная подложка арены с сеткой
        ctx.fillStyle = 'rgba(7, 12, 32, 0.72)';
        roundRectPath(ctx, 8, 8, ARENA_W - 16, ARENA_H - 16, 18);
        ctx.fill();

        // Тонкая кибер-сетка
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.045)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let gx = 60; gx < ARENA_W - 20; gx += 60) {
            ctx.moveTo(gx, 12);
            ctx.lineTo(gx, ARENA_H - 12);
        }
        for (let gy = 60; gy < ARENA_H - 20; gy += 60) {
            ctx.moveTo(12, gy);
            ctx.lineTo(ARENA_W - 12, gy);
        }
        ctx.stroke();

        // Неоновая силовая рамка (П-образный барьер)
        const pulse = 0.55 + 0.2 * Math.sin(timeSec * 2.5);
        ctx.strokeStyle = `rgba(0, 240, 255, ${pulse})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(10, ARENA_H - 18);
        ctx.lineTo(10, 24);
        ctx.quadraticCurveTo(10, 10, 24, 10);
        ctx.lineTo(ARENA_W - 24, 10);
        ctx.quadraticCurveTo(ARENA_W - 10, 10, ARENA_W - 10, 24);
        ctx.lineTo(ARENA_W - 10, ARENA_H - 18);
        ctx.stroke();
    }

    function drawBricks(timeSec) {
        for (const br of state.bricks) {
            ctx.save();
            roundRectPath(ctx, br.x, br.y, br.w, br.h, 7);

            if (br.type === 'solid') {
                const grad = ctx.createLinearGradient(br.x, br.y, br.x, br.y + br.h);
                grad.addColorStop(0, '#6c7c9c');
                grad.addColorStop(1, '#313b54');
                ctx.fillStyle = grad;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#9fb2d9';
                ctx.stroke();
            } else if (br.type === 'explosive') {
                const glowPulse = 0.75 + 0.25 * Math.sin(timeSec * 8);
                const grad = ctx.createLinearGradient(br.x, br.y, br.x, br.y + br.h);
                grad.addColorStop(0, `rgba(255, 160, 45, ${glowPulse})`);
                grad.addColorStop(1, '#c92a10');
                ctx.fillStyle = grad;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#ffe066';
                ctx.stroke();

                ctx.fillStyle = '#fff8dc';
                ctx.font = 'bold 14px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('💥', br.x + br.w * 0.5, br.y + br.h * 0.5 + 1);
            } else {
                const grad = ctx.createLinearGradient(br.x, br.y, br.x, br.y + br.h);
                grad.addColorStop(0, br.color.main);
                grad.addColorStop(1, br.color.dark);
                ctx.fillStyle = grad;
                ctx.fill();

                // Стеклянный блик сверху
                ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
                roundRectPath(ctx, br.x + 3, br.y + 2, br.w - 6, br.h * 0.36, 4);
                ctx.fill();

                // Бронированная рамка и индикатор прочности
                if (br.maxHp > 1) {
                    roundRectPath(ctx, br.x, br.y, br.w, br.h, 7);
                    ctx.lineWidth = 2.4;
                    ctx.strokeStyle = br.hp >= 3 ? '#ffd447' : '#e4f0ff';
                    ctx.stroke();

                    ctx.fillStyle = '#ffffff';
                    ctx.font = '800 12px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('×' + br.hp, br.x + br.w * 0.5, br.y + br.h * 0.5 + 1);
                }
            }

            if (br.hitFlash > 0) {
                roundRectPath(ctx, br.x, br.y, br.w, br.h, 7);
                ctx.fillStyle = `rgba(255, 255, 255, ${br.hitFlash * 0.65})`;
                ctx.fill();
            }

            ctx.restore();
        }
    }

    function drawPowerups() {
        for (const p of state.powerups) {
            ctx.save();
            const left = p.x - p.w * 0.5;
            const top = p.y - p.h * 0.5;

            roundRectPath(ctx, left, top, p.w, p.h, 12);
            ctx.fillStyle = 'rgba(12, 20, 48, 0.92)';
            ctx.fill();
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = p.def.color;
            ctx.stroke();

            ctx.fillStyle = p.def.color;
            ctx.font = '800 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.def.label, p.x, p.y + 1);
            ctx.restore();
        }
    }

    function drawShield(timeSec) {
        if (!state.shieldActive) return;
        const alpha = 0.55 + 0.25 * Math.sin(timeSec * 6);
        ctx.save();
        ctx.strokeStyle = `rgba(92, 157, 255, ${alpha})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(14, 890);
        ctx.lineTo(ARENA_W - 14, 890);
        ctx.stroke();
        ctx.restore();
    }

    function drawPaddle(timeSec) {
        const p = state.paddle;
        const left = p.x - p.w * 0.5;
        const top = p.y - p.h * 0.5;

        ctx.save();
        // Свечение под платформой
        const glowGrad = ctx.createRadialGradient(p.x, p.y + 4, 4, p.x, p.y + 4, p.w * 0.6);
        glowGrad.addColorStop(0, 'rgba(0, 240, 255, 0.35)');
        glowGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
        ctx.fillStyle = glowGrad;
        ctx.fillRect(left - 20, top - 14, p.w + 40, p.h + 32);

        const padGrad = ctx.createLinearGradient(left, top, left + p.w, top);
        padGrad.addColorStop(0, '#00f0ff');
        padGrad.addColorStop(0.5, '#e8fbff');
        padGrad.addColorStop(1, state.wideTimer > 0 ? '#39ff88' : '#ff3df0');

        roundRectPath(ctx, left, top, p.w, p.h, 9);
        ctx.fillStyle = padGrad;
        ctx.fill();

        // Центральное ядро платформы
        const corePulse = 0.7 + 0.3 * Math.sin(timeSec * 7);
        ctx.fillStyle = `rgba(10, 20, 50, ${corePulse})`;
        roundRectPath(ctx, p.x - 18, top + 5, 36, p.h - 10, 4);
        ctx.fill();
        ctx.restore();
    }

    function drawBalls() {
        const isFire = state.fireballTimer > 0;
        const coreColor = isFire ? '#ff9933' : '#ffffff';
        const trailColor = isFire ? '255, 120, 40' : '0, 240, 255';

        for (const b of state.balls) {
            // Шлейф за шаром
            for (let i = 0; i < b.trail.length; i++) {
                const t = b.trail[i];
                const ratio = (i + 1) / (b.trail.length + 1);
                ctx.fillStyle = `rgba(${trailColor}, ${ratio * 0.42})`;
                ctx.beginPath();
                ctx.arc(t.x, t.y, b.r * ratio * 0.9, 0, Math.PI * 2);
                ctx.fill();
            }

            // Ореол шара
            const halo = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r * 2.2);
            halo.addColorStop(0, isFire ? 'rgba(255, 150, 40, 0.8)' : 'rgba(0, 240, 255, 0.75)');
            halo.addColorStop(1, 'rgba(0, 240, 255, 0)');
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r * 2.2, 0, Math.PI * 2);
            ctx.fill();

            // Ядро шара
            ctx.fillStyle = coreColor;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawParticlesAndPopups() {
        for (const pt of state.particles) {
            const alpha = Math.max(0, pt.life / pt.maxLife);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = pt.color;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.size * alpha + 0.6, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        for (const pp of state.popups) {
            const alpha = Math.min(1, (pp.life / pp.maxLife) * 1.4);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = '800 17px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.fillText(pp.text, pp.x + 1.5, pp.y + 1.5);
            ctx.fillStyle = pp.color;
            ctx.fillText(pp.text, pp.x, pp.y);
            ctx.restore();
        }
    }

    function drawActiveBuffBars() {
        let slotY = 26;
        if (state.wideTimer > 0) {
            drawBuffIndicator(26, slotY, '↔ ПЛАТФОРМА', state.wideTimer / 13, '#39ff88');
            slotY += 22;
        }
        if (state.fireballTimer > 0) {
            drawBuffIndicator(26, slotY, '🔥 ПЛАЗМА', state.fireballTimer / 8.5, '#ff7b29');
        }
    }

    function drawBuffIndicator(x, y, label, ratio, color) {
        ctx.save();
        ctx.fillStyle = 'rgba(8, 14, 34, 0.8)';
        roundRectPath(ctx, x, y, 148, 16, 8);
        ctx.fill();

        ctx.fillStyle = color;
        roundRectPath(ctx, x + 2, y + 2, Math.max(8, 144 * Math.min(1, ratio)), 12, 6);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + 8, y + 8.5);
        ctx.restore();
    }

    function drawLaunchPrompt(timeSec) {
        if (state.mode !== 'playing') return;
        const hasAttached = state.balls.some((b) => b.attached);
        if (!hasAttached) return;

        const alpha = 0.55 + 0.4 * Math.sin(timeSec * 4.2);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#d8eeff';
        ctx.font = '700 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Нажми или отпусти палец, чтобы запустить шар', ARENA_W * 0.5, ARENA_H - 118);
        ctx.restore();
    }

    function roundRectPath(context, x, y, w, h, r) {
        const radius = Math.min(r, w * 0.5, h * 0.5);
        context.beginPath();
        context.moveTo(x + radius, y);
        context.lineTo(x + w - radius, y);
        context.quadraticCurveTo(x + w, y, x + w, y + radius);
        context.lineTo(x + w, y + h - radius);
        context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        context.lineTo(x + radius, y + h);
        context.quadraticCurveTo(x, y + h, x, y + h - radius);
        context.lineTo(x, y + radius);
        context.quadraticCurveTo(x, y, x + radius, y);
        context.closePath();
    }

    // =========================================================================
    // Базовая инициализация Yandex Games SDK при старте игры
    // =========================================================================
    let booted = false;
    function bootOnce() {
        if (booted) return;
        booted = true;
        initGame();
    }

    function startApp() {
        if (typeof YaGames !== 'undefined') {
            // Страховочный таймер для локального запуска вне iframe Яндекс Игр
            const localFallbackTimer = setTimeout(bootOnce, 1200);

            YaGames.init().then(async ysdk => {
                clearTimeout(localFallbackTimer);
                window.ysdk = ysdk;

                // Загружаем облачные сохранения игрока (Player API: getData) перед сигналом готовности
                await Promise.race([
                    CloudSave.init(ysdk),
                    new Promise(resolve => setTimeout(resolve, 2000))
                ]);

                // Повторная синхронизация, если игрок авторизовался во время сессии
                if (typeof ysdk.on === 'function' && ysdk.EVENTS) {
                    const authEvent = ysdk.EVENTS.ACCOUNT_SELECTION_DIALOG_CLOSED || ysdk.EVENTS.EXTERNAL_AUTH_SUCCESS;
                    if (authEvent) {
                        ysdk.on(authEvent, () => {
                            CloudSave.init(ysdk);
                        });
                    }
                }

                // Инициализация игры
                bootOnce();
                syncUIWithSavedProgress();

                if (ysdk.features && ysdk.features.LoadingAPI) {
                    ysdk.features.LoadingAPI.ready();
                }
            }).catch(err => {
                clearTimeout(localFallbackTimer);
                console.warn('Запуск вне окружения Яндекс Игр:', err);
                bootOnce();
            });
        } else {
            bootOnce();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startApp);
    } else {
        startApp();
    }
})();
