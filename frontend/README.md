# CyberGoose arayüzü

React 19 + TypeScript + Vite. Kurulum, geliştirme ve paketleme adımları kökteki [README.md](../README.md) dosyasında.

```powershell
npm run dev        # Vite, http://localhost:5175 (/api istekleri 127.0.0.1:5502'ye gider)
npm run build      # tsc + vite build, dist/
npm run test:unit  # Vitest
npm run lint       # oxlint
```

Klasörler: `components/` arayüz parçaları, `hooks/` veri ve tema, `services/apiClient.ts` tüm API çağrıları, `styles/` tasarım sistemi token'ları ve `cg-*` stilleri, `__tests__/` testler.
