# Quiz Tool Şemaları

## quiz.startSession
**Params:**
- `participantId: number`

**Return:**
- `sessionId: number`
- `greeting: string`

## quiz.nextQuestion  
**Params:**
- `sessionId: number`

**Return:**
- `sessionQuestionId: number`
- `text: string`
- `choices?: string[]`
- `basePoints: number`
- `tLimitSec: number`

## quiz.reportIntent
**Params:**
- `sessionQuestionId: number`
- `utterance: string`
- `intent: "ANSWER" | "INFO_ZERO_WASTE" | "SMALLTALK" | "HINT_OR_NEXT" | "OFFTOPIC"`
- `confidence?: number`

**Return:**
- `accepted: boolean`

## quiz.markTtsEnd
**Params:**
- `sessionQuestionId: number`
- `ttsEndedAt: string` (ISO string)

**Return:**
- `ok: true`

## quiz.markSpeechStart
**Params:**
- `sessionQuestionId: number`
- `speechStartedAt: string` (ISO string)

**Return:**
- `ok: true`

## quiz.submitAnswer
**Params:**
- `sessionQuestionId: number`
- `answeredAt: string` (ISO string)
- `answerText?: string`
- `choiceKey?: "A" | "B" | "C" | "D"`
- `asrConfidence?: number`
- `finalTranscript?: string`

**Return:**
- `isCorrect: boolean`
- `earnedPoints: number`
- `totalPoints: number`

## quiz.infoLookup
**Params:**
- `query: string`
- `maxSentences?: number`

**Return:**
- `answer: string`
- `sourceId?: string`

## quiz.getLeaderboard
**Params:**
- `limit?: number`

**Return:**
- `items: Array<{name: string, points: number}>`

## quiz.finishSession
**Params:**
- `sessionId: number`

**Return:**
- `totalPoints: number`
- `rank?: number`
