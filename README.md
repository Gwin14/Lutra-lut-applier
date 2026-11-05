# Lutra — LUTs e grading para vídeos log, em lote

App **React Native + Expo (SDK 58)** para celulares e tablets que aplica LUTs e ajustes de cor em vários vídeos de uma vez, com foco em **footage log**. Exporta cada clipe separado ou tudo junto em um vídeo só. Funciona no **Expo Go**: nenhuma funcionalidade depende de módulo nativo fora do Expo Go, e os widgets (que precisam de extensão nativa) são ignorados com segurança lá.

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

Escaneie o QR code com o Expo Go (SDK 58). Para exportar vídeos, o aparelho precisa de **iOS 16.4+** ou **Android System WebView 94+** (WebCodecs).

## Widgets (build de desenvolvimento)

Widgets e Live Activity precisam de uma extensão nativa, então não rodam no Expo Go (lá o app simplesmente os ignora).

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
  EngineProvider    WebView invisível que hospeda o motor; leituras/escritas de arquivo sob demanda
  jobs.ts           lote + preset → job (bake do LUT por grade)
engine/web/main.ts  motor de exportação: WebCodecs + WebGL + mediabunny (vira src/engine/engineHtml.generated.ts)
src/preview/      prévia ao vivo com React Native Skia (useVideo + runtime effect)
src/widgets/      widgets/Live Activity (carregados só se o módulo nativo existir)
src/app/          rotas (Expo Router): abas nativas, editor, exportar, folhas
```

O grade inteiro (conversão log, look, ajustes) é "assado" em um LUT 3D pelo mesmo código TS; a GPU só amostra o LUT e aplica efeitos espaciais. Por isso a prévia, o vídeo exportado e o `.cube` exportado nunca divergem.

**Por que WebView para exportar?** O Expo Go não inclui encoder de vídeo nativo programável. O motor roda dentro de uma WebView (presente no Expo Go) usando **WebCodecs**, que acessa o hardware de vídeo do aparelho. Os bytes dos clipes são entregues sob demanda pelo `expo-file-system`, e a saída é escrita em posições no arquivo final. Os quadros 10-bit/HDR são lidos como planos Y'CbCr crus, para o navegador não aplicar gerenciamento de cor por conta própria.

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
- A exportação pausa se o app for para segundo plano: a WebView é suspensa pelo sistema. A tela fica acesa durante a renderização.
- Disponibilidade de HEVC/AV1 e de AAC na codificação varia por aparelho. O app consulta o hardware e mostra só o que funciona.
- WebM não é aceito pela Galeria do iPhone; ele fica em Exportações para compartilhar.
- D-Log M, Samsung Log e outros sem fórmula pública: use Rec.709 como entrada e importe o LUT oficial do fabricante.
- Widgets de tela bloqueada são do iOS. No Android o progresso aparece no app.

## Licenças

Código do app: MIT. O motor inclui **mediabunny** (MPL-2.0) sem modificações.
