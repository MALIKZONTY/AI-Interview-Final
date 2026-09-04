import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getSpeechAnalyser } from "@/lib/speech";

/**
 * The interviewer: a 3D head whose mouth moves in time with the question audio.
 *
 * The model carries the 52 ARKit blendshapes, so lip movement is driven by writing
 * `jawOpen` and friends from the live amplitude of the speech coming out of
 * lib/speech.ts. That is coarser than true phoneme visemes, but it tracks speech
 * closely enough to read as talking, and it needs no timing data from the voice.
 *
 * Everything here is best-effort: a device without WebGL, or a model that fails to
 * load, falls back to the static portrait the caller renders underneath.
 */

const MODEL_URL = "/avatar/interviewer.glb";

/** Blendshapes driven by loudness, and how much of it each one takes. */
const MOUTH_SHAPES: Record<string, number> = {
  jawOpen: 0.62,
  mouthFunnel: 0.18,
  mouthPucker: 0.09,
  mouthLowerDown_L: 0.16,
  mouthLowerDown_R: 0.16,
  mouthStretch_L: 0.1,
  mouthStretch_R: 0.1,
};

export function InterviewerAvatar({
  speaking,
  className,
}: {
  speaking: boolean;
  className?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const speakingRef = useRef(speaking);
  const [failed, setFailed] = useState(false);

  // Read inside the animation loop without restarting the scene on every phase change.
  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }

    let disposed = false;
    let frame = 0;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth || 320, mount.clientHeight || 320);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      22,
      (mount.clientWidth || 320) / (mount.clientHeight || 320),
      0.1,
      100
    );
    camera.position.set(0, 0.06, 0.62);
    camera.lookAt(0, 0.03, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(0.6, 1.0, 1.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.8);
    rim.position.set(-1.0, 0.4, -0.8);
    scene.add(rim);

    let head: THREE.Object3D | null = null;
    const morphMeshes: THREE.Mesh[] = [];
    let blinkAt = performance.now() + 2200;
    let blinkPhase = -1;

    /** Sets a named blendshape across every mesh that has it. */
    const setMorph = (name: string, value: number) => {
      for (const mesh of morphMeshes) {
        const idx = mesh.morphTargetDictionary?.[name];
        if (idx !== undefined && mesh.morphTargetInfluences) {
          mesh.morphTargetInfluences[idx] = value;
        }
      }
    };

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return;
        head = gltf.scene;
        head.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh && mesh.morphTargetDictionary) morphMeshes.push(mesh);
        });
        // Frame the head consistently regardless of how the model was exported.
        const box = new THREE.Box3().setFromObject(head);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const scale = 0.33 / Math.max(size.y, 1e-3);
        head.scale.setScalar(scale);
        head.position.sub(center.multiplyScalar(scale));
        scene.add(head);
      },
      undefined,
      () => {
        if (!disposed) setFailed(true);
      }
    );

    const bins = new Uint8Array(512);
    let mouth = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();

      // --- mouth, from the live loudness of the interviewer's voice -----------
      let target = 0;
      const analyser = getSpeechAnalyser();
      if (speakingRef.current && analyser) {
        analyser.getByteTimeDomainData(bins);
        let acc = 0;
        for (let i = 0; i < bins.length; i += 1) {
          const v = (bins[i] - 128) / 128;
          acc += v * v;
        }
        // Speech RMS sits low; scale it into a usable jaw range.
        target = Math.min(1, Math.sqrt(acc / bins.length) * 5.5);
      }
      // Asymmetric smoothing: open quickly, close a little slower, like a real jaw.
      mouth += (target - mouth) * (target > mouth ? 0.55 : 0.28);
      for (const [name, weight] of Object.entries(MOUTH_SHAPES)) {
        setMorph(name, mouth * weight);
      }

      // --- blinking, so an idle face does not look frozen ---------------------
      if (blinkPhase < 0 && now >= blinkAt) {
        blinkPhase = 0;
      }
      if (blinkPhase >= 0) {
        blinkPhase += 0.16;
        const closed = Math.sin(Math.min(blinkPhase, Math.PI));
        setMorph("eyeBlink_L", closed);
        setMorph("eyeBlink_R", closed);
        if (blinkPhase >= Math.PI) {
          blinkPhase = -1;
          setMorph("eyeBlink_L", 0);
          setMorph("eyeBlink_R", 0);
          blinkAt = now + 2200 + Math.random() * 3200;
        }
      }

      // --- idle motion, subtle enough not to distract -------------------------
      if (head) {
        const t = now / 1000;
        head.rotation.y = Math.sin(t * 0.35) * 0.055;
        head.rotation.x = Math.sin(t * 0.27) * 0.028;
        head.position.y += Math.sin(t * 0.8) * 0.00004;
      }

      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      const w = mount.clientWidth || 320;
      const h = mount.clientHeight || 320;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  if (failed) return null;
  return <div ref={mountRef} className={className} aria-hidden />;
}
