// AudioContext is explicitly 16 kHz: never relabel 48 kHz samples as 16 kHz.
// 80 ms PCM batches avoid main-thread recording/encoding and large upload waits.
class VoiceCapture extends AudioWorkletProcessor {
  constructor(){super();this.samples=new Int16Array(1280);this.offset=0;this.energy=0;}
  process(inputs){
    const input=inputs[0]?.[0];if(!input)return true;
    for(const value of input){
      const v=Math.max(-1,Math.min(1,value));this.samples[this.offset++]=Math.round(v*(v<0?32768:32767));this.energy+=v*v;
      if(this.offset===this.samples.length){
        const buffer=this.samples.buffer;this.port.postMessage({buffer,level:Math.sqrt(this.energy/this.samples.length)},[buffer]);
        this.samples=new Int16Array(1280);this.offset=0;this.energy=0;
      }
    }return true;
  }
}
registerProcessor('voice-capture',VoiceCapture);
