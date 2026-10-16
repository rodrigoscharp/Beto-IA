"use client";

/* Palco do Fantasminha: renderer, câmera, luz e sombra. O modelo e as animações estão em ./ghost.ts.
   Canvas transparente em tela cheia: o fundo vem do tema (--bg em globals.css). Carregue com next/dynamic + ssr:false. */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createGhost, type Ghost } from "./ghost";
import { mascotEmotion, mascotTalking, shouldHop } from "./mapping";
import { ELEV, FOV, FRAME_MS, stageFit } from "./stage";
import GhostFallback from "./GhostFallback";
import type { Emotion, VoiceState } from "@/lib/emotion";

export interface BetoGhostProps {
  state: VoiceState;
  emotion?: Emotion;
  /** Voz de fato tocando: a boca só mexe com isso. */
  talking?: boolean;
  theme?: "dark" | "light";
  /** Música tocando: ocioso, ele vira DJ. */
  music?: boolean;
  /** Contadores: cada incremento dispara um aceno / uma notificação. */
  waveSignal?: number;
  notifySignal?: number;
  onClick: () => void;
}

const SHADOW = { dark: 0.45, light: 0.18 } as const;

export default function BetoGhost({
  state, emotion = "neutro", talking = false, theme = "dark", music = false,
  waveSignal = 0, notifySignal = 0, onClick,
}: BetoGhostProps) {
  const hostRef   = useRef<HTMLDivElement>(null);
  const ghostRef  = useRef<Ghost | null>(null);
  const groundRef = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial> | null>(null);
  const prevRef   = useRef<{ state: VoiceState; emotion: Emotion } | null>(null);
  const [failed, setFailed] = useState(false);

  /* Cena: monta uma vez. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap foi descontinuado no three r184 (vira PCF de qualquer jeito)
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 20);   // canvas quadrado: aspecto 1

    // estúdio neutro do original (three-d-stage.js), em escala do mascote
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.4, 0.7, 0.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0002;
    Object.assign(key.shadow.camera, { left: -0.3, right: 0.3, top: 0.3, bottom: -0.3, near: 0.01, far: 3 });
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xfff4e6, 0.5);
    fill.position.set(-0.5, 0.3, -0.4);
    scene.add(fill);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: SHADOW.dark }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    groundRef.current = ground;

    const ghost = createGhost();
    scene.add(ghost.group);
    ghostRef.current = ghost;

    // Canvas quadrado no centro da tela, só em volta do mascote (ver ./stage.ts); o clique vale na tela toda.
    const fit = () => {
      const { side, cy, distance: d } = stageFit(host.clientWidth || 1, host.clientHeight || 1);
      renderer.setSize(side, side, false);
      renderer.domElement.style.width = `${side}px`;
      renderer.domElement.style.height = `${side}px`;
      camera.position.set(0, cy + d * Math.sin(ELEV), d * Math.cos(ELEV));
      camera.lookAt(0, cy, 0);
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => ghost.setReducedMotion(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);

    // Teto de 60 quadros por segundo: na taxa do monitor (até 165 Hz) ele dividiria a GPU com o VoiceStudio, que gera
    // a voz, sem ganho visível.
    let last = performance.now();
    const loop = (now: number) => {
      if (now - last < FRAME_MS) return;
      ghost.update((now - last) / 1000, now);
      last = now;
      renderer.render(scene, camera);
    };
    const onVis = () => {
      if (document.hidden) renderer.setAnimationLoop(null);
      else { last = performance.now(); renderer.setAnimationLoop(loop); }
    };
    document.addEventListener("visibilitychange", onVis);
    renderer.setAnimationLoop(loop);

    return () => {
      renderer.setAnimationLoop(null);
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", onMq);
      ro.disconnect();
      ghost.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
      key.dispose();
      fill.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      ghostRef.current = null;
      groundRef.current = null;
    };
  }, []);

  /* Expressão e boca. */
  useEffect(() => {
    const ghost = ghostRef.current;
    if (!ghost) return;
    ghost.setEmotion(mascotEmotion(state, emotion, music));
    ghost.talk(mascotTalking(state, talking));
    const next = { state, emotion };
    if (shouldHop(prevRef.current, next)) ghost.hop();
    prevRef.current = next;
  }, [state, emotion, talking, music]);

  useEffect(() => {
    if (groundRef.current) groundRef.current.material.opacity = SHADOW[theme];
  }, [theme]);

  useEffect(() => { if (waveSignal) ghostRef.current?.wave(); }, [waveSignal]);
  useEffect(() => { if (notifySignal) ghostRef.current?.notify(); }, [notifySignal]);

  return (
    <div
      ref={hostRef}
      onClick={onClick}
      role="button"
      aria-label="Beto"
      style={{ position: "fixed", inset: 0, cursor: "pointer", display: "grid", placeItems: "center" }}
    >
      {failed && <GhostFallback size={Math.min(260, 0.5 * (typeof window === "undefined" ? 520 : Math.min(window.innerWidth, window.innerHeight)))} />}
    </div>
  );
}
