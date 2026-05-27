export function mapPluggyCategory(originalCategory: string | null | undefined): string | null {
  if (!originalCategory) return null;
  const cat = originalCategory.toLowerCase();

  if (
    cat.includes('food') || 
    cat.includes('restaurant') || 
    cat.includes('alimentação') || 
    cat.includes('refeição') ||
    cat.includes('supermercado')
  ) {
    return 'Alimentação';
  }

  if (
    cat.includes('transport') || 
    cat.includes('transporte') || 
    cat.includes('combustível') || 
    cat.includes('gasolina') ||
    cat.includes('parking') ||
    cat.includes('toll') ||
    cat.includes('pedágio')
  ) {
    return 'Transporte';
  }

  if (
    cat.includes('leisure') || 
    cat.includes('lazer') || 
    cat.includes('travel') || 
    cat.includes('viagem') ||
    cat.includes('entretenimento') ||
    cat.includes('cinema') ||
    cat.includes('show')
  ) {
    return 'Lazer';
  }

  if (
    cat.includes('health') || 
    cat.includes('saúde') || 
    cat.includes('medication') || 
    cat.includes('farma') ||
    cat.includes('médico') ||
    cat.includes('dentist')
  ) {
    return 'Saúde';
  }

  if (
    cat.includes('education') || 
    cat.includes('edu') || 
    cat.includes('curso') || 
    cat.includes('escola')
  ) {
    return 'Educação';
  }

  if (
    cat.includes('housing') || 
    cat.includes('moradia') || 
    cat.includes('rent') || 
    cat.includes('aluguel') ||
    cat.includes('utilities') ||
    cat.includes('conta da casa') ||
    cat.includes('claro') ||
    cat.includes('vivo') ||
    cat.includes('tim')
  ) {
    return 'Moradia';
  }

  if (
    cat.includes('salary') || 
    cat.includes('salário') || 
    cat.includes('folha')
  ) {
    return 'Salário';
  }

  if (
    cat.includes('investment') || 
    cat.includes('investimentos') || 
    cat.includes('rendimento') || 
    cat.includes('dividend')
  ) {
    return 'Investimentos';
  }

  if (
    cat.includes('shopping') || 
    cat.includes('compras') || 
    cat.includes('varejo') || 
    cat.includes('marketplace')
  ) {
    return 'Compras Online';
  }

  if (
    cat.includes('subscription') || 
    cat.includes('assinaturas') || 
    cat.includes('netflix') || 
    cat.includes('spotify')
  ) {
    return 'Assinaturas';
  }

  return null;
}
