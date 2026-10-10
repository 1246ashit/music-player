/** jsdom 沒有版面系統，也就沒有 scrollIntoView；補一個空實作，測試再各自 spy。 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
localStorage.setItem('mp-log', 'off');
