# Lutra — LUTs e grading para vídeos log, em lote

App **React Native + Expo (SDK 58)** para celulares e tablets que aplica LUTs e ajustes de cor em vários vídeos de uma vez, com foco em **footage log**. Exporta cada clipe separado ou tudo junto em um vídeo só. A exportação usa um **motor nativo** (AVFoundation + Metal no iOS, MediaCodec + OpenGL ES no Android). O app ainda abre no **Expo Go**, com um motor WebView mais limitado no lugar do nativo, e os widgets são ignorados lá.

## O que ele faz

**Log como foco principal**
- Conversão log → Rec.709 com a **matemática oficial de cada fabricante** (curva + gamut + tone-map filmic), sem precisar de LUT de conversão: Apple Log, S-Log3, S-Log2, V-Log, C-Log3, C-Log2, LogC4, LogC3, F-Log2, F-Log, N-Log, D-Log, Blackmagic Film Gen 5, GoPro Protune Log, HLG.
- **Detecção automática de log** ao importar (contraste/saturação do quadro + padrão do nome do arquivo, ex.: `C0001` → Sony, `DJI_` → DJI).
- Perfil por clipe, então dá para misturar câmeras no mesmo lote.
- Ferramentas de exposição de cinema: **falsa cor**, **zebra** e **scopes** (histograma, waveform, parade RGB), calculados sobre o quadro já graduado.

**Lotes**
- Importa vários vídeos de uma vez (seletor do sistema, sem recompressão, para preservar 10-bit).
- Grade único para o lote todo ou por clipe, copiar grade para todos, trim por clipe, reordenar.
- Exporta **um arquivo por clipe** ou **junta tudo em um vídeo**, com corte seco ou fade entre clipes e fade no início/fim.

**Looks e ajustes**
- 22 looks originais (Essenciais, Cinema, Filme, Natureza, Criativo, P&B) com miniaturas renderizadas **no seu próprio clipe**.
- Importação de LUTs `.cube` (3D 2–129³, 1D, `DOMAIN_MIN/MAX`) e intensidade do look.
- Ajustes: exposição (em luz linear), temperatura, matiz, contraste, altas luzes, sombras, brancos, pretos, saturação, vibração, split toning e fade.
- Efeitos: vinheta, grão de filme animado e nitidez.
- Enquadramento: Original, 16:9, 9:16, 4:5, 1:1, 4:3 e 2.39:1.
- Comparação antes/depois com divisor arrastável, desfazer/refazer e receitas reaplicáveis.

**Exportação**
- MP4, MOV e WebM; H.264, HEVC, AV1 e VP9 (o app mostra só o que o hardware do aparelho codifica).
- Resolução (Original, 4K, 1440p, 1080p, 720p, 540p), fps (original, 24, 25, 30, 50, 60), qualidade e precisão de cor do LUT (33³/65³).
- Áudio copiado sem recompressão quando possível, ou recodificado.
- Salva no álbum "Lutra" da Galeria, com estimativa de tamanho antes de exportar.
- **Exportar o grade como `.cube`** (33³/65³) para usar no Resolve, Premiere ou Final Cut, e **exportar o quadro atual** em PNG na resolução total.

**Widgets (iOS)**
- Tela bloqueada: circular (anel de progresso), retangular e inline, com o progresso da exportação ou um atalho para novo lote.
- Tela inicial: progresso/contagem do dia e **Look do dia**.
- **Live Activity** com o progresso da renderização na tela bloqueada e na Dynamic Island.
- iOS 26: barra acessória das abas mostra a renderização como um mini-player.

## Testar no Expo Go

```bash
npm install
npx expo start
```

Escaneie o QR code com o Expo Go (SDK 58). No Expo Go o motor nativo não existe, então a exportação cai no motor WebView, que precisa de **iOS 16.4+** ou **Android System WebView 94+** (WebCodecs). Para o motor nativo, use um build de desenvolvimento (abaixo).

## Build de desenvolvimento (motor nativo e widgets)

O motor de exportação nativo (`modules/lutra-engine`), os widgets e a Live Activity precisam de código nativo, então não rodam no Expo Go.

```bash
npx expo run:ios               # local, com Xcode
# ou
npx eas-cli@latest build --profile development --platform ios
```

O plugin `expo-widgets` (em `app.json`) cria o target `ExpoWidgetsTarget` e o App Group `group.app.lutra.video`. Para assinar, configure seu Team ID no Xcode/EAS.

## Arquitetura

```
src/color/        ciência de cor em TS puro (roda no app, no motor e nos testes)
  profiles.ts       curvas log oficiais + metadados
  gamuts.ts         matrizes gamut→709 (geradas por scripts/gamut-matrices.mjs)
  grade.ts          pipeline: entrada → balanço/exposição linear → tom → cor → look → acabamento
  lut.ts, cube.ts   LUT 3D, amostragem trilinear, layout em tiles para GPU, .cube
  looks.ts          looks embutidos
src/engine/
  shader.ts         UM programa de cor para dois backends: SkSL (prévia) e GLSL (exportação)
  shader.ts         ...e também MSL (motor iOS) e GLSL OES (motor Android), gerados do mesmo corpo
  EngineProvider    escolhe o motor: módulo nativo quando existe, senão a WebView (Expo Go)
  jobs.ts           lote + preset → job (bake do LUT por grade)
modules/lutra-engine/  motor nativo (Expo Module local)
  ios/              AVAssetReader (Y'CbCr 10-bit) → kernel Metal → AVAssetWriter (H.264/HEVC + AAC)
  android/          MediaExtractor → MediaCodec → SurfaceTexture/GLES → encoder → MediaMuxer
engine/web/main.ts  motor fallback do Expo Go: WebCodecs + WebGL + mediabunny (vira src/engine/engineHtml.generated.ts)
src/preview/      prévia ao vivo com React Native Skia (useVideo + runtime effect)
src/widgets/      widgets/Live Activity (carregados só se o módulo nativo existir)
src/app/          rotas (Expo Router): abas nativas, editor, exportar, folhas
```

O grade inteiro (conversão log, look, ajustes) é "assado" em um LUT 3D pelo mesmo código TS; a GPU só amostra o LUT e aplica efeitos espaciais. Por isso a prévia, o vídeo exportado e o `.cube` exportado nunca divergem.

**Motores de exportação.** Os dois motores falam o mesmo protocolo (`src/engine/protocol.ts`) e recebem o shader de `src/engine/shader.ts` em tempo de execução, então a cor não diverge entre prévia (Skia), iOS (Metal), Android (GLES) e WebView (WebGL).
- **Nativo** (builds de desenvolvimento e produção): lê e grava os arquivos direto no disco, sem passar bytes pela ponte JS. No iOS os quadros chegam como Y'CbCr 10-bit (x420) via IOSurface, sem cópia e sem gerenciamento de cor antes do grade. No Android o decoder renderiza numa textura OES e o quadro graduado vai direto para a surface do encoder.
- **WebView** (só Expo Go): WebCodecs dentro de uma WebView invisível, com os bytes entregues sob demanda pelo `expo-file-system` em base64. Fica como fallback porque o Expo Go não tem encoder nativo programável.

## Scripts

| Comando | O que faz |
|---|---|
| `npm test` | Testes da ciência de cor (cinza 18% de cada perfil, identidade, round-trip .cube, looks, detecção) |
| `npm test -- --engine` | Também roda o motor ponta a ponta no Chromium headless (precisa de ffmpeg): exportação separada e mesclada, 10-bit, rotação, fps, áudio |
| `npm run build:engine` | Reempacota o motor da WebView após mudanças em `engine/web` ou no shader |
| `npm run typecheck` | TypeScript |
| `npm run setup:web` | Copia o CanvasKit para `public/` (só para rodar no navegador) |

## Limitações conhecidas

- O app foi verificado com typecheck, bundles iOS/Android, testes da cor, o motor rodando no Chromium e capturas da versão web. **Ainda não foi rodado em iPhone/Android físico nem em simulador**, então a primeira rodada no Expo Go é o teste de verdade, principalmente a prévia com `useVideo` do Skia, o desempenho e os widgets.
- No iOS a exportação nativa pausa enquanto o app está em segundo plano (o iOS não permite GPU em background) e continua ao voltar. No Android ela segue enquanto o processo estiver vivo. No motor WebView ela para em segundo plano. A tela fica acesa durante a renderização.
- O motor nativo do Android ainda não foi rodado em aparelho/emulador (só compilado). O do iOS foi testado ponta a ponta no Mac (Mac Catalyst) com clipes H.264, HEVC 10-bit e rotacionados.
- No Android, MOV é gravado como MP4 (o `MediaMuxer` não tem MOV), e o áudio de clipes com taxas de amostragem diferentes num merge é descartado. A saída nativa é SDR 8-bit BT.709, como a da WebView.
- Disponibilidade de HEVC/AV1 e de AAC na codificação varia por aparelho. O app consulta o hardware e mostra só o que funciona.
- WebM não é aceito pela Galeria do iPhone; ele fica em Exportações para compartilhar.
- D-Log M, Samsung Log e outros sem fórmula pública: use Rec.709 como entrada e importe o LUT oficial do fabricante.
- Widgets de tela bloqueada são do iOS. No Android o progresso aparece no app.

## Licenças

Código do app: MIT. O motor inclui **mediabunny** (MPL-2.0) sem modificações.
