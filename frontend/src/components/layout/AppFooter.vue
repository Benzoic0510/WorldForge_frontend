<template>
  <footer class="site-footer">
    <div class="site-footer__inner page-container">
      <div class="footer-brand">
        <p class="eyebrow">WorldForge</p>
        <strong>世界观协作创作平台</strong>
        <p>让设定、协作与角色互动在同一个世界里继续生长。</p>
      </div>

      <nav class="footer-group" aria-label="快速导航">
        <h3>快速导航</h3>
        <RouterLink :to="{ name: 'discover' }">发现世界</RouterLink>
        <RouterLink :to="{ name: 'my-worlds' }">我的世界观</RouterLink>
        <RouterLink :to="{ name: 'messages' }">消息中心</RouterLink>
      </nav>

      <div class="footer-group">
        <h3>支持信息</h3>
        <span>使用说明</span>
        <span>协作规范</span>
        <span>关于项目</span>
        <span>反馈</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  margin-top: 52px;
  padding: 28px 0 36px;
  border-top: 1px solid rgb(217 226 220 / 88%);
  background: linear-gradient(180deg, rgb(255 255 255 / 18%), rgb(255 255 255 / 28%));
}

.site-footer__inner {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) repeat(2, minmax(0, 0.72fr));
  gap: 20px;
  align-items: start;
}

.footer-brand {
  display: grid;
  gap: 10px;
}

.eyebrow {
  margin: 0;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.footer-brand strong {
  color: var(--color-ink);
  font-size: 1.05rem;
  font-weight: 900;
}

.footer-brand p:last-child {
  max-width: 30ch;
  margin: 0;
  color: var(--color-muted);
  font-size: 0.96rem;
  line-height: 1.8;
}

.footer-group {
  display: grid;
  gap: 8px;
  align-content: start;
}

.footer-group h3 {
  margin: 0 0 6px;
  color: var(--color-ink);
  font-size: 0.86rem;
  font-family: var(--font-body);
  text-transform: uppercase;
  letter-spacing: 0;
}

.footer-group a,
.footer-group span {
  color: var(--color-muted);
  font-size: 0.92rem;
  line-height: 1.6;
  text-decoration: none;
}

.footer-group a:hover {
  color: var(--color-accent);
}

@media (max-width: 1040px) {
  .site-footer__inner {
    grid-template-columns: 1fr 1fr;
  }

  .footer-brand {
    grid-column: 1 / -1;
  }
}

@media (max-width: 640px) {
  .site-footer {
    margin-top: 40px;
    padding: 24px 0 32px;
  }

  .site-footer__inner {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}
</style>
