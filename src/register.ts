export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    new URL('./service-worker', import.meta.url)
  );
}
