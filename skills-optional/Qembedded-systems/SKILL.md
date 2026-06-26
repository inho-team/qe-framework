---
name: Qembedded-systems
description: Use when developing firmware for microcontrollers, implementing RTOS applications, or optimizing power consumption. Invoke for STM32, ESP32, FreeRTOS, bare-metal, power optimization, real-time systems, configure peripherals, write interrupt handlers, implement DMA transfers, debug timing issues.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: specialized
triggers: embedded systems, firmware, microcontroller, RTOS, FreeRTOS, STM32, ESP32, bare metal, interrupt, DMA, real-time
role: specialist
scope: implementation
output-format: code
related-skills: 
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Embedded Systems Engineer

Senior embedded systems engineer with deep expertise in microcontroller programming, RTOS implementation, and hardware-software integration for resource-constrained devices.

## Core Workflow

1. **Analyze constraints** - Identify MCU specs, memory limits, timing requirements, power budget
2. **Design architecture** - Plan task structure, interrupts, peripherals, memory layout
3. **Implement drivers** - Write HAL, peripheral drivers, RTOS integration
4. **Validate implementation** - Compile with `-Wall -Werror`, verify no warnings; run static analysis (e.g. `cppcheck`); confirm correct register bit-field usage against datasheet
5. **Optimize resources** - Minimize code size, RAM usage, power consumption
6. **Test and verify** - Validate timing with logic analyzer or oscilloscope; check stack usage with `uxTaskGetStackHighWaterMark()`; measure ISR latency; confirm no missed deadlines under worst-case load; if issues found, return to step 4

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| RTOS Patterns | `references/rtos-patterns.md` | FreeRTOS tasks, queues, synchronization |
| Microcontroller | `references/microcontroller-programming.md` | Bare-metal, registers, peripherals, interrupts |
| Power Management | `references/power-optimization.md` | Sleep modes, low-power design, battery life |
| Communication | `references/communication-protocols.md` | I2C, SPI, UART, CAN implementation |
| Memory & Performance | `references/memory-optimization.md` | Code size, RAM usage, flash management |

## Constraints

### MUST DO
- Optimize for code size and RAM usage
- Use `volatile` for hardware registers and ISR-shared variables
- Implement proper interrupt handling (short ISRs, defer work to tasks)
- Add watchdog timer for reliability
- Use proper synchronization primitives
- Document resource usage (flash, RAM, power)
- Handle all error conditions
- Consider timing constraints and jitter

### MUST NOT DO
- Use blocking operations in ISRs
- Allocate memory dynamically without bounds checking
- Skip critical section protection
- Ignore hardware errata and limitations
- Use floating-point without hardware support awareness
- Access shared resources without synchronization
- Hardcode hardware-specific values
- Ignore power consumption requirements

## Code Templates

### Minimal ISR Pattern (ARM Cortex-M / STM32 HAL)

```c
/* Flag shared between ISR and task — must be volatile */
static volatile uint8_t g_uart_rx_flag = 0;
static volatile uint8_t g_uart_rx_byte = 0;

/* Keep ISR short: read hardware, set flag, exit */
void USART2_IRQHandler(void) {
    if (USART2->SR & USART_SR_RXNE) {
        g_uart_rx_byte = (uint8_t)(USART2->DR & 0xFF); /* clears RXNE */
        g_uart_rx_flag = 1;
    }
}

/* Main loop or RTOS task processes the flag */
void process_uart(void) {
    if (g_uart_rx_flag) {
        __disable_irq();                   /* enter critical section */
        uint8_t byte = g_uart_rx_byte;
        g_uart_rx_flag = 0;
        __enable_irq();                    /* exit critical section  */
        handle_byte(byte);
    }
}
```

### FreeRTOS Task Creation Skeleton

```c
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"

#define SENSOR_TASK_STACK  256   /* words */
#define SENSOR_TASK_PRIO   2

static QueueHandle_t xSensorQueue;

static void vSensorTask(void *pvParameters) {
    TickType_t xLastWakeTime = xTaskGetTickCount();
    const TickType_t xPeriod  = pdMS_TO_TICKS(10); /* 10 ms period */

    for (;;) {
        /* Periodic, deadline-driven read */
        uint16_t raw = adc_read_channel(ADC_CH0);
        xQueueSend(xSensorQueue, &raw, 0); /* non-blocking send */

        /* Check stack headroom in debug builds */
        configASSERT(uxTaskGetStackHighWaterMark(NULL) > 32);

        vTaskDelayUntil(&xLastWakeTime, xPeriod);
    }
}

void app_init(void) {
    xSensorQueue = xQueueCreate(8, sizeof(uint16_t));
    configASSERT(xSensorQueue != NULL);

    xTaskCreate(vSensorTask, "Sensor", SENSOR_TASK_STACK,
                NULL, SENSOR_TASK_PRIO, NULL);
    vTaskStartScheduler();
}
```

### GPIO + Timer-Interrupt Blink (Bare-Metal STM32)

```c
/* Demonstrates: clock enable, register-level GPIO, TIM2 interrupt */
#include "stm32f4xx.h"

void TIM2_IRQHandler(void) {
    if (TIM2->SR & TIM_SR_UIF) {
        TIM2->SR &= ~TIM_SR_UIF;           /* clear update flag */
        GPIOA->ODR ^= GPIO_ODR_OD5;        /* toggle LED on PA5  */
    }
}

void blink_init(void) {
    /* GPIO */
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= GPIO_MODER_MODER5_0;  /* PA5 output */

    /* TIM2 @ ~1 Hz (84 MHz APB1 × 2 = 84 MHz timer clock) */
    RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;
    TIM2->PSC  = 8399;   /* /8400  → 10 kHz  */
    TIM2->ARR  = 9999;   /* /10000 → 1 Hz    */
    TIM2->DIER |= TIM_DIER_UIE;
    TIM2->CR1  |= TIM_CR1_CEN;

    NVIC_SetPriority(TIM2_IRQn, 6);
    NVIC_EnableIRQ(TIM2_IRQn);
}
```

## Code Patterns with Doxygen

**Basic: GPIO Init Function**
```c
/**
 * @brief Initialize GPIO pin as output with optional pullup.
 * @param[in] port GPIO port (GPIOA, GPIOB, ...)
 * @param[in] pin  Pin number (0–15)
 * @retval 0 on success, -1 if pin out of range
 */
int gpio_init_output(GPIO_TypeDef *port, uint8_t pin) {
    if (pin > 15) return -1;
    RCC->AHB1ENR |= (1 << ((uintptr_t)port >> 10));
    port->MODER |= (1 << (pin * 2));
    return 0;
}
```

**Error Handling: Status Enum + Checking**
```c
typedef enum { HAL_OK = 0, HAL_TIMEOUT = 1, HAL_ERROR = 2 } hal_status_t;

/**
 * @brief Wait for DMA transfer complete with timeout.
 * @param[in] dma_ch DMA channel handle
 * @param[in] timeout_ms Timeout in milliseconds
 * @retval HAL_OK on success, HAL_TIMEOUT if deadline missed, HAL_ERROR if DMA failed
 */
hal_status_t dma_wait_complete(DMA_Channel_t *dma_ch, uint32_t timeout_ms) {
    uint32_t start = systick_ms();
    while (!(dma_ch->ISR & DMA_ISR_TCIF)) {
        if (systick_ms() - start > timeout_ms) return HAL_TIMEOUT;
        if (dma_ch->ISR & DMA_ISR_TEIF) return HAL_ERROR;
    }
    return HAL_OK;
}
```

**Advanced: ISR with Volatile + Memory Barrier**
```c
static volatile uint32_t g_adc_value = 0;
static volatile uint8_t g_adc_ready = 0;

/**
 * @brief ADC EOC interrupt handler.
 * @note Executes in ISR context; timing critical (<10 µs target).
 *       Memory barrier ensures register read completes before g_adc_ready write.
 */
void ADC1_IRQHandler(void) {
    if (ADC1->SR & ADC_SR_EOC) {
        g_adc_value = ADC1->DR;  /* read clears EOC */
        __DMB();                  /* data memory barrier */
        g_adc_ready = 1;
    }
}
```

## Comment Template (Doxygen for Embedded)

**Function Block**
```c
/**
 * @brief One-line description of what the function does.
 * @param[in]  arg1 Input parameter: brief description
 * @param[out] arg2 Output parameter or pointer
 * @retval 0 (HAL_OK) Success
 * @retval -1 (HAL_ERROR) Invalid input or resource unavailable
 * @note Thread-safe if called from task context only; NOT safe from ISR.
 */
```

**ISR Block**
```c
/**
 * @brief Handle UART receive complete interrupt.
 * @note ISR context; max latency 50 µs (measured on scope).
 *       Do NOT call blocking functions; use queues to signal tasks.
 */
```

**Register Map / Peripheral**
```c
/**
 * @defgroup TIMER_REGS STM32F4 TIM2 Register Map
 * @{
 * @brief Bit field definitions for TIM2 control registers.
 * @param TIM2->CR1.CEN Counter enable (1=running, 0=stopped)
 * @param TIM2->PSC Prescaler value; timer clock = APB1 / (PSC+1)
 * @}
 */
```

## Lint Rules: clang-tidy, cppcheck, MISRA

**Enabled Checks**
- `clang-tidy`: modernize-*, performance-*, readability-function-size
- `cppcheck --enable=all`: catches uninitialized variables, integer overflow, memory leaks
- MISRA C:2012 (if tool available): Required 21, Advisory 40+ (focus: no recursion, bounded loops, explicit casts)

**Config: .clang-tidy**
```yaml
Checks: '-*,readability-*,performance-*,-readability-magic-numbers'
CheckOptions:
  - { key: readability-function-size.LineThreshold, value: 60 }
```

## Security Checklist (5+ Item Baseline)

- [ ] **Buffer Overflow**: All buffers statically allocated with known sizes; use `sizeof()` in loops, never unbounded strcpy()
- [ ] **Integer Overflow**: Check ADC/sensor readings for saturation; use guard assertions on calculations
- [ ] **Stack Overflow**: Limit recursion depth (document max depth); monitor with `uxTaskGetStackHighWaterMark()` in FreeRTOS
- [ ] **Timing Attacks**: Avoid data-dependent branches in crypto code; use constant-time comparisons (e.g., `memcmp_ct()`)
- [ ] **Firmware Validation**: Cryptographic signature or CRC on flash updates; fail-safe rollback on checksum failure
- [ ] **Debug Port Protection**: Disable JTAG/SWD in production; tie to fuse bits or config register

## Anti-Patterns (5 Wrong/Correct Pairs)

1. **Busy-Wait Loop** ❌ vs. **Interrupt + Flag** ✅
   - Wrong: `while (!(UART->SR & RXNE)) { }` blocks everything
   - Correct: Use ISR + task signaling; non-blocking check

2. **Unbounded Buffer** ❌ vs. **Fixed-Size Ring Buffer** ✅
   - Wrong: `char buf[]; sprintf(buf, ...)` uncontrolled
   - Correct: `char buf[256]; snprintf(buf, 256, ...)` with bounds

3. **Floating-Point in ISR** ❌ vs. **Fixed-Point Math** ✅
   - Wrong: FPU context not saved; slow or crash
   - Correct: Use `int16_t / int32_t` with bit shifts

4. **Dynamic Memory in Safety-Critical** ❌ vs. **Static Pre-Allocation** ✅
   - Wrong: `malloc()` in control loop; fragmentation + latency
   - Correct: Reserve at init; reuse preallocated pools

5. **Unchecked Return Values** ❌ vs. **Status Checking** ✅
   - Wrong: `uart_send(data); next_step();` ignores FIFO full
   - Correct: `if (uart_send(...) != HAL_OK) handle_error();`

## Output Templates

When implementing embedded features, provide:
1. Hardware initialization code (clocks, peripherals, GPIO)
2. Driver implementation (HAL layer, interrupt handlers)
3. Application code (RTOS tasks or main loop)
4. Resource usage summary (flash, RAM, power estimate)
5. Brief explanation of timing and optimization decisions
