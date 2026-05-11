import { randomInt } from 'crypto'

interface Challenge {
  text: string
  answer: number
}

const NOISE_CHARS = ['{', '}', '@', '!', '*', '~', '<', '>', '#', '^', '|', '\\', '?', '_', '.', '[', ']', '/', '-']

const CN_NUMBERS: Record<number, string> = {
  0: '零', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五',
  6: '六', 7: '七', 8: '八', 9: '九', 10: '十', 11: '十一',
  12: '十二', 13: '十三', 14: '十四', 15: '十五', 16: '十六',
  17: '十七', 18: '十八', 19: '十九', 20: '二十',
}

const ESPERANTO_NUMBERS: Record<number, string> = {
  10: 'dek', 11: 'dek-unu', 12: 'dek-du', 13: 'dek-tri', 14: 'dek-kvar',
  15: 'dek-kvin', 16: 'dek-ses', 17: 'dek-sep', 18: 'dek-ok', 19: 'dek-naŭ',
  20: 'dudek', 30: 'tridek', 40: 'kvardek', 50: 'kvindek',
}

function randomNumber(min: number, max: number): number {
  return randomInt(min, max + 1)
}

function obfuscateNumber(n: number): string {
  const roll = Math.random()
  if (roll < 0.3 && CN_NUMBERS[n]) return CN_NUMBERS[n]
  if (roll < 0.5 && ESPERANTO_NUMBERS[n]) return ESPERANTO_NUMBERS[n]
  return String(n)
}

function obfuscateText(text: string): string {
  let result = ''
  for (const ch of text) {
    if (Math.random() < 0.15 && ch !== ' ') {
      result += NOISE_CHARS[randomInt(0, NOISE_CHARS.length)]
    }
    if (Math.random() < 0.5) {
      result += ch.toUpperCase()
    } else {
      result += ch.toLowerCase()
    }
    if (Math.random() < 0.1 && ch === ' ') {
      result += ' ' + NOISE_CHARS[randomInt(0, NOISE_CHARS.length)] + ' '
    }
  }
  return result
}

function generateWorkerProblem(): Challenge {
  const totalWorkers = randomNumber(8, 20)
  const totalDays = randomNumber(12, 30)
  const quitWorkers = randomNumber(2, totalWorkers - 3)
  const quitAfterDay = randomNumber(1, 4)

  const totalWork = totalWorkers * totalDays
  const workDoneBeforeQuit = totalWorkers * quitAfterDay
  const remainingWork = totalWork - workDoneBeforeQuit
  const remainingWorkers = totalWorkers - quitWorkers
  const extraDays = Math.ceil(remainingWork / remainingWorkers)
  const answer = quitAfterDay + extraDays

  const text = `if ${obfuscateNumber(totalWorkers)} workers complete a job in ${obfuscateNumber(totalDays)} days but ${obfuscateNumber(quitWorkers)} quit after day ${obfuscateNumber(quitAfterDay)} how many total days to finish`
  return { text: obfuscateText(text), answer }
}

function generateDiscountProblem(): Challenge {
  const pctOver = randomNumber(10, 40)
  const pctUnder = randomNumber(5, 25)
  const threshold = randomNumber(20, 50)
  const itemA = randomNumber(threshold + 5, threshold + 50)
  const itemB = randomNumber(5, threshold - 1)

  const priceA = Math.round(itemA * (100 - pctOver)) / 100
  const priceB = Math.round(itemB * (100 - pctUnder)) / 100
  const answer = Math.round((priceA + priceB) * 100) / 100

  const text = `a store has ${obfuscateNumber(pctOver)} percent off items over ${obfuscateNumber(threshold)} dollars and ${obfuscateNumber(pctUnder)} percent off items under ${obfuscateNumber(threshold)} dollars whats the combined price of a ${obfuscateNumber(itemA)} dollar item and a ${obfuscateNumber(itemB)} dollar item`
  return { text: obfuscateText(text), answer }
}

function generateSpeedProblem(): Challenge {
  const speedA = randomNumber(30, 80)
  const speedB = randomNumber(30, 80)
  const distance = randomNumber(100, 500)

  const timeA = distance / speedA
  const timeB = distance / speedB
  const answer = Math.round((timeA + timeB) * 100) / 100

  const text = `a car drives ${obfuscateNumber(distance)} km at ${obfuscateNumber(speedA)} km per hour then returns at ${obfuscateNumber(speedB)} km per hour what is the total time in hours`
  return { text: obfuscateText(text), answer }
}

function generatePoolProblem(): Challenge {
  const pipeAHours = randomNumber(3, 12)
  const pipeBHours = randomNumber(3, 12)

  const combined = (pipeAHours * pipeBHours) / (pipeAHours + pipeBHours)
  const answer = Math.round(combined * 100) / 100

  const text = `pipe a fills a pool in ${obfuscateNumber(pipeAHours)} hours pipe b fills same pool in ${obfuscateNumber(pipeBHours)} hours how many hours to fill together`
  return { text: obfuscateText(text), answer }
}

export function generateChallenge(): Challenge {
  const generators = [generateWorkerProblem, generateDiscountProblem, generateSpeedProblem, generatePoolProblem]
  const gen = generators[randomInt(0, generators.length)]
  return gen()
}
