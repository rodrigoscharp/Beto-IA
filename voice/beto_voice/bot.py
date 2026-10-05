"""Uma sessão de voz: monta o pipeline do Pipecat para uma conexão WebRTC e roda até o navegador desligar.

transport.input() → [rtvi] → stt → gate → user_aggregator → brain_llm → tts → transport.output() → assistant_aggregator
"""

from __future__ import annotations

import time

from loguru import logger
from pipecat.audio.turn.smart_turn.base_smart_turn import SmartTurnParams
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMMessagesAppendFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.processors.frameworks.rtvi import RTVIObserverParams, RTVIProcessor
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.turns.empty_user_turn import EmptyUserTurnConfig
from pipecat.turns.user_start import TranscriptionUserTurnStartStrategy, VADUserTurnStartStrategy
from pipecat.turns.user_stop import TurnAnalyzerUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.workers.runner import WorkerRunner

from .brain import BetoBrainLLMService, BrainClient
from .config import Config
from .gate import ConversationGate
from .gate_processor import GateProcessor
from .stt import build_stt


def build_tts(cfg: Config) -> ElevenLabsTTSService:
    t = cfg.tts
    return ElevenLabsTTSService(
        api_key=t.api_key,
        settings=ElevenLabsTTSService.Settings(
            voice=t.voice_id,
            model=t.model,
            language=Language.PT,
            stability=t.stability,
            similarity_boost=t.similarity_boost,
            style=t.style,
            speed=t.speed,
            use_speaker_boost=True,
        ),
    )


async def run_bot(connection: SmallWebRTCConnection, cfg: Config) -> None:
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True, audio_out_10ms_chunks=2),
    )

    gate = ConversationGate(
        wake_words=cfg.turn.wake_words,
        end_phrases=cfg.turn.end_phrases,
        follow_up_secs=cfg.turn.follow_up_secs,
        listen_secs=cfg.turn.listen_secs,
    )
    stt = build_stt(cfg.stt)
    brain = BrainClient(cfg.brain.url, cfg.brain.token, cfg.brain.history, cfg.brain.timeout_secs)
    llm = BetoBrainLLMService(brain)
    tts = build_tts(cfg)

    context = LLMContext()
    user_agg, assistant_agg = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(
                params=VADParams(stop_secs=cfg.turn.vad_stop_secs, start_secs=cfg.turn.vad_start_secs, confidence=cfg.turn.vad_confidence)
            ),
            user_turn_strategies=UserTurnStrategies(
                start=[VADUserTurnStartStrategy(enable_interruptions=cfg.turn.barge_in), TranscriptionUserTurnStartStrategy()],
                stop=[
                    TurnAnalyzerUserTurnStopStrategy(
                        turn_analyzer=LocalSmartTurnAnalyzerV3(
                            params=SmartTurnParams(stop_secs=cfg.turn.smart_turn_stop_secs, max_duration_secs=cfg.turn.smart_turn_max_duration_secs)
                        )
                    )
                ],
            ),
            # Turno sem transcrição (tosse, ruído, fala que o gate descartou): nada de resposta.
            empty_user_turn=EmptyUserTurnConfig(interrupted_prompt=None, idle_prompt=None),
        ),
    )

    rtvi = RTVIProcessor()
    pipeline = Pipeline([transport.input(), stt, GateProcessor(gate), user_agg, llm, tts, transport.output(), assistant_agg])
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, audio_in_sample_rate=16000),
        rtvi_processor=rtvi,
        rtvi_observer_params=RTVIObserverParams(metrics_enabled=False),
        idle_timeout_secs=None,   # a sessão vive enquanto o navegador estiver conectado; silêncio longo é normal
    )
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)

    @rtvi.event_handler("on_client_message")
    async def on_client_message(_rtvi: RTVIProcessor, msg):
        kind = msg.type
        data = msg.data if isinstance(msg.data, dict) else {}
        now = time.monotonic()
        if kind == "listen":
            gate.on_listen(now)
        elif kind == "ptt":
            gate.on_ptt(bool(data.get("down")))
        elif kind == "interrupt":
            await rtvi.interrupt_bot()
        elif kind == "say":
            text = str(data.get("text", "")).strip()
            if text:
                await worker.queue_frames([TTSSpeakFrame(text)])
        elif kind == "text":
            text = str(data.get("text", "")).strip()
            if text:
                gate.on_turn_forwarded()
                await worker.queue_frames([LLMMessagesAppendFrame(messages=[{"role": "user", "content": text}], run_llm=True)])
        elif kind == "end":
            gate.close()
        else:
            logger.warning(f"[bot] mensagem desconhecida do cliente: {kind}")

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_t, _client):
        logger.info("[bot] navegador conectado")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_t, _client):
        logger.info("[bot] navegador desconectou")
        await runner.cancel()

    try:
        await runner.run()
    finally:
        await brain.aclose()
