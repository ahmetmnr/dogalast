/**
 * Timer Component
 * Visual countdown timer with warnings and animations
 */

export class Timer {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Timer container not found: ${containerId}`);
    }

    this.options = {
      warningThresholds: [30, 10, 5], // seconds
      onTimeUp: () => {},
      onTimeWarning: () => {},
      ...options
    };

    this.timeLimit = 0;
    this.remainingTime = 0;
    this.isActive = false;
    this.interval = null;
    this.warningsTriggered = new Set();
    
    this.render();
  }

  /**
   * Start timer with specified time limit
   */
  start(timeLimit) {
    this.timeLimit = timeLimit;
    this.remainingTime = timeLimit;
    this.isActive = true;
    this.warningsTriggered.clear();
    
    this.updateDisplay();
    this.startCountdown();
    
    console.log(`Timer started: ${timeLimit} seconds`);
  }

  /**
   * Stop timer
   */
  stop() {
    this.isActive = false;
    this.clearInterval();
    
    console.log('Timer stopped');
  }

  /**
   * Pause timer
   */
  pause() {
    this.isActive = false;
    this.clearInterval();
    
    console.log('Timer paused');
  }

  /**
   * Resume timer
   */
  resume() {
    if (this.remainingTime > 0) {
      this.isActive = true;
      this.startCountdown();
      
      console.log('Timer resumed');
    }
  }

  /**
   * Reset timer
   */
  reset() {
    this.stop();
    this.remainingTime = this.timeLimit;
    this.warningsTriggered.clear();
    this.updateDisplay();
  }

  /**
   * Get remaining time
   */
  getRemainingTime() {
    return this.remainingTime;
  }

  /**
   * Check if timer is active
   */
  isRunning() {
    return this.isActive;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Start countdown interval
   */
  startCountdown() {
    this.clearInterval();
    
    this.interval = setInterval(() => {
      if (!this.isActive || this.remainingTime <= 0) {
        this.clearInterval();
        return;
      }

      this.remainingTime--;
      this.updateDisplay();
      this.checkWarnings();

      if (this.remainingTime <= 0) {
        this.handleTimeUp();
      }
    }, 1000);
  }

  /**
   * Clear countdown interval
   */
  clearInterval() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Check for time warnings
   */
  checkWarnings() {
    this.options.warningThresholds.forEach(threshold => {
      if (this.remainingTime === threshold && !this.warningsTriggered.has(threshold)) {
        this.warningsTriggered.add(threshold);
        this.options.onTimeWarning(this.remainingTime);
        
        // Visual warning
        this.showTimeWarning(threshold);
      }
    });
  }

  /**
   * Handle time up
   */
  handleTimeUp() {
    this.isActive = false;
    this.remainingTime = 0;
    this.clearInterval();
    
    this.updateDisplay();
    this.showTimeUp();
    
    this.options.onTimeUp();
    
    console.log('Timer finished - time up');
  }

  /**
   * Show time warning
   */
  showTimeWarning(threshold) {
    const timerContainer = this.container.querySelector('.timer-container');
    if (timerContainer) {
      timerContainer.classList.add('warning');
      
      // Remove warning class after animation
      setTimeout(() => {
        timerContainer.classList.remove('warning');
      }, 1000);
    }
    
    console.log(`Time warning: ${threshold} seconds remaining`);
  }

  /**
   * Show time up state
   */
  showTimeUp() {
    const timerContainer = this.container.querySelector('.timer-container');
    if (timerContainer) {
      timerContainer.classList.add('time-up');
    }
    
    const statusElement = this.container.querySelector('.timer-status');
    if (statusElement) {
      statusElement.innerHTML = '<span class="status-text finished">⏰ Süre doldu</span>';
    }
  }

  /**
   * Update timer display
   */
  updateDisplay() {
    const minutes = Math.floor(this.remainingTime / 60);
    const seconds = this.remainingTime % 60;
    const percentage = this.timeLimit > 0 ? (this.remainingTime / this.timeLimit) * 100 : 0;

    // Update time display
    const timeElement = this.container.querySelector('.timer-time');
    if (timeElement) {
      timeElement.textContent = minutes > 0 
        ? `${minutes}:${seconds.toString().padStart(2, '0')}`
        : seconds.toString();
    }

    const unitElement = this.container.querySelector('.timer-unit');
    if (unitElement) {
      unitElement.textContent = minutes > 0 ? 'dk' : 'sn';
    }

    // Update progress circle
    const progressCircle = this.container.querySelector('.timer-progress');
    if (progressCircle) {
      const circumference = 2 * Math.PI * 45; // radius = 45
      const offset = circumference * (1 - percentage / 100);
      progressCircle.style.strokeDashoffset = offset;
    }

    // Update timer state classes
    const timerContainer = this.container.querySelector('.timer-container');
    if (timerContainer) {
      // Remove all state classes
      timerContainer.classList.remove('normal', 'caution', 'warning', 'critical');
      
      // Add current state class
      const state = this.getTimerState();
      timerContainer.classList.add(state);
      
      // Add active/paused class
      timerContainer.classList.toggle('active', this.isActive);
      timerContainer.classList.toggle('paused', !this.isActive && this.remainingTime > 0);
    }

    // Update status text
    this.updateStatusText();
  }

  /**
   * Get current timer state
   */
  getTimerState() {
    if (this.remainingTime <= 5) return 'critical';
    if (this.remainingTime <= 10) return 'warning';
    if (this.remainingTime <= 30) return 'caution';
    return 'normal';
  }

  /**
   * Update status text
   */
  updateStatusText() {
    const statusElement = this.container.querySelector('.timer-status');
    if (!statusElement) return;

    const state = this.getTimerState();
    
    let statusHTML = '';
    
    if (this.remainingTime === 0) {
      statusHTML = '<span class="status-text finished">⏰ Süre doldu</span>';
    } else if (!this.isActive && this.remainingTime > 0) {
      statusHTML = '<span class="status-text paused">⏸️ Durduruldu</span>';
    } else if (state === 'critical') {
      statusHTML = '<span class="status-text critical">⚠️ Süre bitiyor!</span>';
    } else if (state === 'warning') {
      statusHTML = '<span class="status-text warning">⏰ Son 10 saniye</span>';
    } else if (state === 'caution') {
      statusHTML = '<span class="status-text caution">🕐 Son 30 saniye</span>';
    }
    
    statusElement.innerHTML = statusHTML;
  }

  /**
   * Render timer component
   */
  render() {
    this.container.innerHTML = `
      <div class="timer-container normal">
        <!-- Circular Progress -->
        <div class="timer-circle">
          <svg class="timer-svg" viewBox="0 0 100 100" aria-hidden="true">
            <!-- Background circle -->
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="var(--color-gray-200)"
              stroke-width="8"
            />
            
            <!-- Progress circle -->
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              stroke-width="8"
              stroke-linecap="round"
              stroke-dasharray="${2 * Math.PI * 45}"
              stroke-dashoffset="0"
              class="timer-progress"
            />
          </svg>
          
          <!-- Timer Display -->
          <div class="timer-display">
            <span class="timer-time">0</span>
            <span class="timer-unit">sn</span>
          </div>
        </div>
        
        <!-- Timer Status -->
        <div class="timer-status" aria-live="polite">
          <!-- Status text will be updated here -->
        </div>
      </div>
    `;

    // Add CSS transitions
    const timerContainer = this.container.querySelector('.timer-container');
    if (timerContainer) {
      timerContainer.style.transition = 'all 300ms ease-in-out';
    }

    const progressCircle = this.container.querySelector('.timer-progress');
    if (progressCircle) {
      progressCircle.style.transition = 'stroke-dashoffset 1s linear';
    }
  }
}

export default Timer;

