// Task: add two numbers.
interface AdditionStrategy {
  apply(a: number, b: number): number;
}

class StandardAdditionStrategy implements AdditionStrategy {
  apply(a: number, b: number): number {
    return a + b;
  }
}

class AdditionStrategyFactory {
  static create(): AdditionStrategy {
    return new StandardAdditionStrategy();
  }
}

abstract class AbstractCalculatorBase {
  protected abstract getStrategy(): AdditionStrategy;
  public compute(a: number, b: number): number {
    return this.getStrategy().apply(a, b);
  }
}

class Calculator extends AbstractCalculatorBase {
  private readonly strategy: AdditionStrategy;
  constructor(strategy: AdditionStrategy = AdditionStrategyFactory.create()) {
    super();
    this.strategy = strategy;
  }
  protected getStrategy(): AdditionStrategy {
    return this.strategy;
  }
}

export function add(a: number, b: number): number {
  return new Calculator().compute(a, b);
}
