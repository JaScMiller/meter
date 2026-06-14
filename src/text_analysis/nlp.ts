import winkNLP, { type ItemToken, type PartOfSpeech } from 'wink-nlp'
import model from 'wink-eng-lite-web-model'

const nlp = winkNLP(model)

export interface NlpWordToken {
  value: string;
  pos: PartOfSpeech;
}

export function tokenizeText(text: string): NlpWordToken[] {
  const doc = nlp.readDoc(text)

  const output: NlpWordToken[] = []

  doc.tokens().each((item: ItemToken) => {
    const text = item.out(nlp.its.value);
    const pos: PartOfSpeech = item.out(nlp.its.pos) as PartOfSpeech;
    
    output.push({
      value: text,
      pos: pos
    })
  })
  
  return output;
}